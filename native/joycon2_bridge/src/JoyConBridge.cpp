#define NOMINMAX
#include "JoyConBridge.h"

#include <Windows.h>
#include <algorithm>
#include <chrono>
#include <sstream>
#include <thread>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.Streams.h>

#include "BLECommands.h"
#include "ConfigManager.h"
#include "DeviceManager.h"
#include "JoyConDecoder.h"
#include "PlayerManager.h"
#include "ViGEm/Client.h"
#include "ViGEmManager.h"

using namespace winrt;

namespace {

bool InitializeWinRTApartment() {
    try {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        return true;
    } catch (const winrt::hresult_error& ex) {
        const HRESULT code = ex.code();
        // Bereits initialisiert oder von Electron mit anderem Apartment-Modus gestartet.
        if (code == CO_E_ALREADYINITIALIZED || code == RPC_E_CHANGED_MODE) {
            return true;
        }
        return false;
    } catch (...) {
        return false;
    }
}

struct BridgePlayer {
    std::string id;
    ConnectedJoyCon joycon;
    PVIGEM_TARGET target = nullptr;
    JoyConSide side = JoyConSide::Left;
    JoyConOrientation orientation = JoyConOrientation::Upright;
    ControllerType controllerType = ControllerType::SingleJoyCon;
    uint64_t bleAddress = 0;
    std::unique_ptr<VibrationContext> vibCtx;
    JoyConBridge::PlayerInputState* inputState = nullptr;
};

std::vector<std::unique_ptr<BridgePlayer>> g_players;
ConnectedJoyCon g_pendingDualRight{};
GyroSource g_pendingDualGyro = GyroSource::Both;
std::atomic<int> g_scanMode{ 0 }; // 0 single, 1 dual first, 2 dual second, 3 pro
JoyConSide g_scanSide = JoyConSide::Left;
JoyConOrientation g_scanOrientation = JoyConOrientation::Upright;
ControllerType g_scanProType = ControllerType::ProController;
} // namespace

// Expose Emit for helper functions
void JoyConBridge::EmitPublic(const BridgeEvent& event) {
    Emit(event);
}

JoyConBridge::JoyConBridge() = default;

JoyConBridge::~JoyConBridge() {
    Shutdown();
}

bool JoyConBridge::Initialize(BridgeEventCallback callback) {
    if (initialized_.load()) return true;
    callback_ = std::move(callback);

    try {
        if (!InitializeWinRTApartment()) {
            Emit({ BridgeEventType::Error, {}, {}, false, "WinRT apartment init failed" });
            return false;
        }
    } catch (...) {
        Emit({ BridgeEventType::Error, {}, {}, false, "WinRT apartment init failed" });
        return false;
    }

    ConfigManager::Instance().EnsureDefaults();

    const bool vigemOk = ViGEmManager::Instance().Initialize();
    Emit({ BridgeEventType::VigemStatus, {}, {}, vigemOk });
    if (!vigemOk) {
        Emit({ BridgeEventType::Error, {}, {}, false, "ViGEmBus not available" });
    }

    initialized_.store(true);
    return true;
}

void JoyConBridge::Shutdown() {
    if (!initialized_.load()) return;
    StopScan();
    DisconnectAll();
    ViGEmManager::Instance().Shutdown();
    initialized_.store(false);
}

bool JoyConBridge::IsViGEmConnected() const {
    return ViGEmManager::Instance().IsConnected();
}

int JoyConBridge::GetPlayerCount() const {
    return static_cast<int>(g_players.size());
}

std::string JoyConBridge::MakePlayerId(uint64_t bleAddress, int slot) const {
    std::ostringstream oss;
    oss << "joycon2:" << bleAddress << ":" << slot;
    return oss.str();
}

JoyConBridge::PlayerInputState* JoyConBridge::FindOrCreateState(const std::string& playerId) {
    std::lock_guard<std::mutex> lock(stateMutex_);
    for (auto& entry : playerStates_) {
        if (entry.first == playerId) return &entry.second;
    }
    playerStates_.push_back({ playerId, PlayerInputState{} });
    return &playerStates_.back().second;
}

void JoyConBridge::Emit(const BridgeEvent& event) {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    if (callback_) callback_(event);
}

void JoyConBridge::EmitInputFromReport(const std::string& playerId, const DS4_REPORT_EX& report) {
    auto* state = FindOrCreateState(playerId);
    if (!state) return;

    const uint16_t buttons = report.Report.wButtons;
    const uint8_t dpad = buttons & 0xF;

    auto trackBtn = [&](uint16_t mask, const std::string& logical, uint16_t& storage) {
        const bool pressed = (buttons & mask) != 0;
        const bool was = (storage & mask) != 0;
        if (pressed != was) {
            storage = pressed ? static_cast<uint16_t>(storage | mask) : static_cast<uint16_t>(storage & ~mask);
            BridgeEvent event{};
            event.type = BridgeEventType::Input;
            event.playerId = playerId;
            event.logicalButton = logical;
            event.stringValue = pressed ? "button-down" : "button-up";
            Emit(event);
        }
    };

    auto trackDpad = [&](uint8_t direction, const std::string& logical, uint8_t& storage) {
        const bool pressed = dpad == direction;
        const bool was = storage == direction;
        if (pressed && !was) {
            storage = direction;
            BridgeEvent event{};
            event.type = BridgeEventType::Input;
            event.playerId = playerId;
            event.logicalButton = logical;
            event.stringValue = "button-down";
            Emit(event);
        } else if (!pressed && was) {
            storage = 0;
            BridgeEvent event{};
            event.type = BridgeEventType::Input;
            event.playerId = playerId;
            event.logicalButton = logical;
            event.stringValue = "button-up";
            Emit(event);
        }
    };

    trackBtn(DS4_BUTTON_CROSS, "a", state->buttons);
    trackBtn(DS4_BUTTON_CIRCLE, "b", state->buttons);
    trackBtn(DS4_BUTTON_SQUARE, "x", state->buttons);
    trackBtn(DS4_BUTTON_TRIANGLE, "y", state->buttons);
    trackBtn(DS4_BUTTON_SHOULDER_LEFT, "leftShoulder", state->buttons);
    trackBtn(DS4_BUTTON_SHOULDER_RIGHT, "rightShoulder", state->buttons);
    trackBtn(DS4_BUTTON_THUMB_LEFT, "leftStick", state->buttons);
    trackBtn(DS4_BUTTON_THUMB_RIGHT, "rightStick", state->buttons);
    trackBtn(DS4_BUTTON_SHARE, "back", state->buttons);
    trackBtn(DS4_BUTTON_OPTIONS, "start", state->buttons);
    trackBtn(DS4_BUTTON_TRIGGER_LEFT, "leftTrigger", state->buttons);
    trackBtn(DS4_BUTTON_TRIGGER_RIGHT, "rightTrigger", state->buttons);

    if (report.Report.bSpecial & DS4_SPECIAL_BUTTON_PS) {
        if (!(state->special & 0x01)) {
            state->special |= 0x01;
            BridgeEvent event{};
            event.type = BridgeEventType::Input;
            event.playerId = playerId;
            event.logicalButton = "guide";
            event.stringValue = "button-down";
            Emit(event);
        }
    } else if (state->special & 0x01) {
        state->special &= ~0x01;
        BridgeEvent event{};
        event.type = BridgeEventType::Input;
        event.playerId = playerId;
        event.logicalButton = "guide";
        event.stringValue = "button-up";
        Emit(event);
    }

    trackDpad(DS4_BUTTON_DPAD_NORTH, "dpadUp", state->dpad);
    trackDpad(DS4_BUTTON_DPAD_SOUTH, "dpadDown", state->dpad);
    trackDpad(DS4_BUTTON_DPAD_WEST, "dpadLeft", state->dpad);
    trackDpad(DS4_BUTTON_DPAD_EAST, "dpadRight", state->dpad);

    const auto emitAxis = [&](int16_t value, int16_t& previous, const std::string& axisName) {
        double normalized = static_cast<double>(value) / 32767.0;
        if (std::abs(normalized) < 0.08) normalized = 0.0;
        const int16_t scaled = static_cast<int16_t>(normalized * 32767);
        if (std::abs(scaled - previous) < 900) return;
        previous = scaled;
        BridgeEvent event{};
        event.type = BridgeEventType::Input;
        event.playerId = playerId;
        event.logicalAxis = axisName;
        event.stringValue = "axis";
        event.numberValue = normalized;
        Emit(event);
    };

    const int16_t lx = static_cast<int16_t>((report.Report.bThumbLX - 128) * 257);
    const int16_t ly = static_cast<int16_t>((report.Report.bThumbLY - 128) * 257);
    const int16_t rx = static_cast<int16_t>((report.Report.bThumbRX - 128) * 257);
    const int16_t ry = static_cast<int16_t>((report.Report.bThumbRY - 128) * 257);

    emitAxis(lx, state->lx, "leftStickX");
    emitAxis(ly, state->ly, "leftStickY");
    emitAxis(rx, state->rx, "rightStickX");
    emitAxis(ry, state->ry, "rightStickY");
}

void JoyConBridge::StopScan() {
    DeviceManager::Instance().StopScan();
    Emit({ BridgeEventType::ScanState, {}, "idle" });
}

void JoyConBridge::DisconnectAll() {
    for (auto it = g_players.rbegin(); it != g_players.rend(); ++it) {
        DisconnectPlayer((*it)->id);
    }
}

void JoyConBridge::DisconnectPlayer(const std::string& playerId) {
    for (auto it = g_players.begin(); it != g_players.end(); ++it) {
        if ((*it)->id != playerId) continue;

        if ((*it)->target) {
            vigem_target_ds4_unregister_notification((*it)->target);
            ViGEmManager::Instance().RemoveTarget((*it)->target);
        }

        g_players.erase(it);
        Emit({ BridgeEventType::PlayerDisconnected, playerId });
        return;
    }
}

bool AddBridgePlayer(JoyConBridge* bridge, ConnectedJoyCon cj, ControllerType type,
                     JoyConSide side = JoyConSide::Left,
                     JoyConOrientation orientation = JoyConOrientation::Upright) {
    auto& vigem = ViGEmManager::Instance();
    PVIGEM_TARGET target = vigem.AllocDS4();
    if (!target || !vigem.AddTarget(target)) return false;

    auto player = std::make_unique<BridgePlayer>();
    player->id = bridge->MakePlayerId(cj.bleAddress, static_cast<int>(g_players.size() + 1));
    player->joycon = cj;
    player->target = target;
    player->side = side;
    player->orientation = orientation;
    player->controllerType = type;
    player->bleAddress = cj.bleAddress;
    player->inputState = bridge->FindOrCreateState(player->id);

    player->vibCtx = std::make_unique<VibrationContext>();
    player->vibCtx->writeChar = cj.writeChar;
    vigem_target_ds4_register_notification(
        vigem.GetClient(), target, DS4VibrationCallback, player->vibCtx.get());

    BridgePlayer* playerPtr = player.get();
    g_players.push_back(std::move(player));

    playerPtr->joycon.inputChar.ValueChanged(
        [bridge, playerPtr](auto const&, auto const& args) {
            auto reader = winrt::Windows::Storage::Streams::DataReader::FromBuffer(args.CharacteristicValue());
            std::vector<uint8_t> buffer(reader.UnconsumedBufferLength());
            reader.ReadBytes(buffer);

            DS4_REPORT_EX report{};
            if (playerPtr->controllerType == ControllerType::ProController) {
                report = GenerateProControllerReport(buffer);
            } else if (playerPtr->controllerType == ControllerType::NSOGCController) {
                report = GenerateNSOGCReport(buffer);
            } else {
                report = GenerateDS4Report(buffer, playerPtr->side, playerPtr->orientation);
            }

            if (playerPtr->target) {
                vigem_target_ds4_update_ex(
                    ViGEmManager::Instance().GetClient(), playerPtr->target, report);
            }
            bridge->EmitInputFromReport(playerPtr->id, report);
        });

    const auto status = playerPtr->joycon.inputChar
        .WriteClientCharacteristicConfigurationDescriptorAsync(
            winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::
                GattClientCharacteristicConfigurationDescriptorValue::Notify)
        .get();

    if (playerPtr->joycon.writeChar) {
        SendCustomCommands(playerPtr->joycon.writeChar);
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        SetPlayerLEDs(playerPtr->joycon.writeChar, static_cast<uint8_t>(1 << g_players.size()));
        EmitSound(playerPtr->joycon.writeChar);
    }

    if (status != winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattCommunicationStatus::Success) {
        bridge->DisconnectPlayer(playerPtr->id);
        return false;
    }

    BridgeEvent connected{};
    connected.type = BridgeEventType::PlayerConnected;
    connected.playerId = playerPtr->id;
    connected.intValue = static_cast<int>(type);
    connected.stringValue = (side == JoyConSide::Left) ? "left" : "right";
    bridge->EmitPublic(connected);
    return true;
}

void JoyConBridge::StartScanSingle(int side, int orientation) {
    g_scanMode.store(0);
    g_scanSide = side == 0 ? JoyConSide::Left : JoyConSide::Right;
    g_scanOrientation = orientation == 0 ? JoyConOrientation::Upright : JoyConOrientation::Sideways;
    Emit({ BridgeEventType::ScanState, {}, "scanning" });

    DeviceManager::Instance().StartScan([this](ConnectedJoyCon cj, ScanState state) {
        if (state == ScanState::Found) {
            if (AddBridgePlayer(this, cj, ControllerType::SingleJoyCon, g_scanSide, g_scanOrientation)) {
                Emit({ BridgeEventType::ScanState, {}, "found" });
            } else {
                Emit({ BridgeEventType::ScanState, {}, "error" });
            }
        } else if (state == ScanState::Timeout) {
            Emit({ BridgeEventType::ScanState, {}, "timeout" });
        } else if (state == ScanState::Error) {
            Emit({ BridgeEventType::ScanState, {}, "error" });
        }
    });
}

void JoyConBridge::StartScanDualFirst(int gyroSource) {
    g_scanMode.store(1);
    g_pendingDualGyro = static_cast<GyroSource>(gyroSource);
    Emit({ BridgeEventType::ScanState, {}, "scanning" });

    DeviceManager::Instance().StartScan([this](ConnectedJoyCon cj, ScanState state) {
        if (state == ScanState::Found) {
            g_pendingDualRight = cj;
            if (cj.writeChar) {
                SendCustomCommands(cj.writeChar);
                SetPlayerLEDs(cj.writeChar, 0x01);
                EmitSound(cj.writeChar);
            }
            Emit({ BridgeEventType::ScanState, {}, "dual-right-found" });
        } else if (state == ScanState::Timeout) {
            Emit({ BridgeEventType::ScanState, {}, "timeout" });
        } else if (state == ScanState::Error) {
            Emit({ BridgeEventType::ScanState, {}, "error" });
        }
    });
}

void JoyConBridge::StartScanDualSecond() {
    g_scanMode.store(2);
    Emit({ BridgeEventType::ScanState, {}, "scanning" });

    DeviceManager::Instance().StartScan([this](ConnectedJoyCon cj, ScanState state) {
        if (state != ScanState::Found) {
            if (state == ScanState::Timeout) Emit({ BridgeEventType::ScanState, {}, "timeout" });
            if (state == ScanState::Error) Emit({ BridgeEventType::ScanState, {}, "error" });
            return;
        }

        auto& vigem = ViGEmManager::Instance();
        PVIGEM_TARGET target = vigem.AllocDS4();
        if (!target || !vigem.AddTarget(target)) {
            Emit({ BridgeEventType::ScanState, {}, "error" });
            return;
        }

        auto player = std::make_unique<BridgePlayer>();
        player->id = MakePlayerId(g_pendingDualRight.bleAddress, static_cast<int>(g_players.size() + 1));
        player->target = target;
        player->controllerType = ControllerType::DualJoyCon;
        player->bleAddress = g_pendingDualRight.bleAddress;
        player->inputState = FindOrCreateState(player->id);

        player->vibCtx = std::make_unique<VibrationContext>();
        player->vibCtx->isDual = true;
        player->vibCtx->writeCharLeft = cj.writeChar;
        player->vibCtx->writeCharRight = g_pendingDualRight.writeChar;
        vigem_target_ds4_register_notification(
            vigem.GetClient(), target, DS4VibrationCallback, player->vibCtx.get());

        struct DualInputBuffers {
            std::atomic<std::shared_ptr<std::vector<uint8_t>>> left{ std::make_shared<std::vector<uint8_t>>() };
            std::atomic<std::shared_ptr<std::vector<uint8_t>>> right{ std::make_shared<std::vector<uint8_t>>() };
        };
        auto buffers = std::make_shared<DualInputBuffers>();

        const std::string playerId = player->id;
        g_players.push_back(std::move(player));

        auto onInput = [this, playerId, target](
            const std::vector<uint8_t>& left,
            const std::vector<uint8_t>& right) {
            DS4_REPORT_EX report = GenerateDualJoyConDS4Report(left, right, g_pendingDualGyro);
            vigem_target_ds4_update_ex(ViGEmManager::Instance().GetClient(), target, report);
            EmitInputFromReport(playerId, report);
        };

        cj.inputChar.ValueChanged([buffers, onInput](auto const&, auto const& args) {
            auto reader = winrt::Windows::Storage::Streams::DataReader::FromBuffer(args.CharacteristicValue());
            auto buf = std::make_shared<std::vector<uint8_t>>(reader.UnconsumedBufferLength());
            reader.ReadBytes(*buf);
            buffers->left.store(buf);
            onInput(*buffers->left.load(), *buffers->right.load());
        });
        cj.inputChar.WriteClientCharacteristicConfigurationDescriptorAsync(
            winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::
                GattClientCharacteristicConfigurationDescriptorValue::Notify).get();

        g_pendingDualRight.inputChar.ValueChanged([buffers, onInput](auto const&, auto const& args) {
            auto reader = winrt::Windows::Storage::Streams::DataReader::FromBuffer(args.CharacteristicValue());
            auto buf = std::make_shared<std::vector<uint8_t>>(reader.UnconsumedBufferLength());
            reader.ReadBytes(*buf);
            buffers->right.store(buf);
            onInput(*buffers->left.load(), *buffers->right.load());
        });
        g_pendingDualRight.inputChar.WriteClientCharacteristicConfigurationDescriptorAsync(
            winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::
                GattClientCharacteristicConfigurationDescriptorValue::Notify).get();

        if (cj.writeChar) {
            SendCustomCommands(cj.writeChar);
            SetPlayerLEDs(cj.writeChar, 0x08);
            EmitSound(cj.writeChar);
        }

        BridgeEvent connected{};
        connected.type = BridgeEventType::PlayerConnected;
        connected.playerId = playerId;
        connected.intValue = static_cast<int>(ControllerType::DualJoyCon);
        connected.stringValue = "dual";
        Emit(connected);
        Emit({ BridgeEventType::ScanState, {}, "found" });
        g_pendingDualRight = ConnectedJoyCon{};
    });
}

void JoyConBridge::StartScanPro(int controllerType) {
    g_scanProType = controllerType == 4 ? ControllerType::NSOGCController : ControllerType::ProController;
    g_scanMode.store(3);
    Emit({ BridgeEventType::ScanState, {}, "scanning" });

    DeviceManager::Instance().StartScan([this](ConnectedJoyCon cj, ScanState state) {
        if (state == ScanState::Found) {
            if (AddBridgePlayer(this, cj, g_scanProType)) {
                Emit({ BridgeEventType::ScanState, {}, "found" });
            } else {
                Emit({ BridgeEventType::ScanState, {}, "error" });
            }
        } else if (state == ScanState::Timeout) {
            Emit({ BridgeEventType::ScanState, {}, "timeout" });
        } else if (state == ScanState::Error) {
            Emit({ BridgeEventType::ScanState, {}, "error" });
        }
    });
}
