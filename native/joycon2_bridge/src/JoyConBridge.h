#pragma once

#define NOMINMAX
#include <Windows.h>

#include <ViGEm/Client.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

enum class BridgeEventType {
    VigemStatus,
    ScanState,
    PlayerConnected,
    PlayerDisconnected,
    Input,
    Error,
};

struct BridgeEvent {
    BridgeEventType type;
    std::string playerId;
    std::string scanState;
    bool boolValue = false;
    std::string stringValue;
    std::string logicalButton;
    std::string logicalAxis;
    double numberValue = 0.0;
    int intValue = 0;
};

using BridgeEventCallback = std::function<void(const BridgeEvent&)>;

class JoyConBridge {
public:
    struct PlayerInputState {
        uint16_t buttons = 0;
        uint8_t special = 0;
        uint8_t dpad = 0;
        int16_t lx = 0;
        int16_t ly = 0;
        int16_t rx = 0;
        int16_t ry = 0;
        uint8_t triggerL = 0;
        uint8_t triggerR = 0;
    };

    JoyConBridge();
    ~JoyConBridge();

    bool Initialize(BridgeEventCallback callback);
    void Shutdown();

    bool IsViGEmConnected() const;
    int GetPlayerCount() const;

    void StartScanSingle(int side, int orientation);
    void StartScanDualFirst(int gyroSource);
    void StartScanDualSecond();
    void StartScanPro(int controllerType);
    void StopScan();
    void DisconnectPlayer(const std::string& playerId);
    void DisconnectAll();

    void EmitInputFromReport(const std::string& playerId, const DS4_REPORT_EX& report);
    void EmitPublic(const BridgeEvent& event);
    PlayerInputState* FindOrCreateState(const std::string& playerId);
    std::string MakePlayerId(uint64_t bleAddress, int slot) const;

private:
    void Emit(const BridgeEvent& event);

    BridgeEventCallback callback_;
    std::atomic<bool> initialized_{ false };
    std::mutex callbackMutex_;
    std::mutex stateMutex_;
    std::vector<std::pair<std::string, PlayerInputState>> playerStates_;
};
