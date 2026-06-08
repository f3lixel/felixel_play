#define NOMINMAX
#include <Windows.h>

#include <napi.h>

#include <memory>
#include <mutex>

#include "JoyConBridge.h"

namespace {

std::unique_ptr<JoyConBridge> g_bridge;
Napi::ThreadSafeFunction g_tsfn;
std::mutex g_tsfnMutex;

Napi::Object BridgeEventToObject(Napi::Env env, const BridgeEvent& event) {
    Napi::Object obj = Napi::Object::New(env);
    switch (event.type) {
        case BridgeEventType::VigemStatus:
            obj.Set("type", "vigem-status");
            obj.Set("connected", event.boolValue);
            break;
        case BridgeEventType::ScanState:
            obj.Set("type", "scan-state");
            obj.Set("state", event.scanState);
            break;
        case BridgeEventType::PlayerConnected:
            obj.Set("type", "player-connected");
            obj.Set("playerId", event.playerId);
            obj.Set("controllerType", event.intValue);
            obj.Set("side", event.stringValue);
            break;
        case BridgeEventType::PlayerDisconnected:
            obj.Set("type", "player-disconnected");
            obj.Set("playerId", event.playerId);
            break;
        case BridgeEventType::Input:
            obj.Set("type", event.stringValue);
            obj.Set("playerId", event.playerId);
            if (!event.logicalButton.empty()) {
                obj.Set("logicalButton", event.logicalButton);
            }
            if (!event.logicalAxis.empty()) {
                obj.Set("logicalAxis", event.logicalAxis);
                obj.Set("value", event.numberValue);
            }
            break;
        case BridgeEventType::Error:
            obj.Set("type", "error");
            obj.Set("message", event.stringValue);
            break;
    }
    return obj;
}

void DispatchBridgeEvent(const BridgeEvent& event) {
    std::lock_guard<std::mutex> lock(g_tsfnMutex);
    if (!g_tsfn) return;

    auto* payload = new BridgeEvent(event);
    g_tsfn.NonBlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, BridgeEvent* data) {
        Napi::HandleScope scope(env);
        jsCallback.Call({ BridgeEventToObject(env, *data) });
        delete data;
    });
}

Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    {
        std::lock_guard<std::mutex> lock(g_tsfnMutex);
        if (g_tsfn) {
            g_tsfn.Release();
        }
        g_tsfn = Napi::ThreadSafeFunction::New(
            env,
            info[0].As<Napi::Function>(),
            "JoyCon2Bridge",
            0,
            1);
    }

    if (!g_bridge) {
        g_bridge = std::make_unique<JoyConBridge>();
    }

    const bool ok = g_bridge->Initialize(DispatchBridgeEvent);
    return Napi::Boolean::New(env, ok);
}

Napi::Value Shutdown(const Napi::CallbackInfo& info) {
    if (g_bridge) {
        g_bridge->Shutdown();
        g_bridge.reset();
    }
    {
        std::lock_guard<std::mutex> lock(g_tsfnMutex);
        if (g_tsfn) {
            g_tsfn.Release();
        }
    }
    return info.Env().Undefined();
}

Napi::Value IsViGEmConnected(const Napi::CallbackInfo& info) {
    const bool connected = g_bridge && g_bridge->IsViGEmConnected();
    return Napi::Boolean::New(info.Env(), connected);
}

Napi::Value GetPlayerCount(const Napi::CallbackInfo& info) {
    const int count = g_bridge ? g_bridge->GetPlayerCount() : 0;
    return Napi::Number::New(info.Env(), count);
}

Napi::Value StartScanSingle(const Napi::CallbackInfo& info) {
    if (!g_bridge) return info.Env().Undefined();
    const int side = info.Length() > 0 ? info[0].As<Napi::Number>().Int32Value() : 0;
    const int orientation = info.Length() > 1 ? info[1].As<Napi::Number>().Int32Value() : 0;
    g_bridge->StartScanSingle(side, orientation);
    return info.Env().Undefined();
}

Napi::Value StartScanDualFirst(const Napi::CallbackInfo& info) {
    if (!g_bridge) return info.Env().Undefined();
    const int gyroSource = info.Length() > 0 ? info[0].As<Napi::Number>().Int32Value() : 0;
    g_bridge->StartScanDualFirst(gyroSource);
    return info.Env().Undefined();
}

Napi::Value StartScanDualSecond(const Napi::CallbackInfo& info) {
    if (g_bridge) g_bridge->StartScanDualSecond();
    return info.Env().Undefined();
}

Napi::Value StartScanPro(const Napi::CallbackInfo& info) {
    if (!g_bridge) return info.Env().Undefined();
    const int controllerType = info.Length() > 0 ? info[0].As<Napi::Number>().Int32Value() : 3;
    g_bridge->StartScanPro(controllerType);
    return info.Env().Undefined();
}

Napi::Value StopScan(const Napi::CallbackInfo& info) {
    if (g_bridge) g_bridge->StopScan();
    return info.Env().Undefined();
}

Napi::Value DisconnectPlayer(const Napi::CallbackInfo& info) {
    if (!g_bridge || info.Length() < 1) return info.Env().Undefined();
    g_bridge->DisconnectPlayer(info[0].As<Napi::String>().Utf8Value());
    return info.Env().Undefined();
}

Napi::Value DisconnectAll(const Napi::CallbackInfo& info) {
    if (g_bridge) g_bridge->DisconnectAll();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("initialize", Napi::Function::New(env, Initialize));
    exports.Set("shutdown", Napi::Function::New(env, Shutdown));
    exports.Set("isViGEmConnected", Napi::Function::New(env, IsViGEmConnected));
    exports.Set("getPlayerCount", Napi::Function::New(env, GetPlayerCount));
    exports.Set("startScanSingle", Napi::Function::New(env, StartScanSingle));
    exports.Set("startScanDualFirst", Napi::Function::New(env, StartScanDualFirst));
    exports.Set("startScanDualSecond", Napi::Function::New(env, StartScanDualSecond));
    exports.Set("startScanPro", Napi::Function::New(env, StartScanPro));
    exports.Set("stopScan", Napi::Function::New(env, StopScan));
    exports.Set("disconnectPlayer", Napi::Function::New(env, DisconnectPlayer));
    exports.Set("disconnectAll", Napi::Function::New(env, DisconnectAll));
    return exports;
}

NODE_API_MODULE(joycon2_bridge, Init)

} // namespace
