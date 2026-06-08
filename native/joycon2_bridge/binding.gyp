{
  "targets": [
    {
      "target_name": "joycon2_bridge",
      "sources": [
        "src/addon.cpp",
        "src/JoyConBridge.cpp",
        "../../joycon2-connector-main/joycon2_connector/src/JoyConDecoder.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src",
        "../../joycon2-connector-main/joycon2_connector/src",
        "../../joycon2-connector-main/joycon2_connector/include",
        "../../joycon2-connector-main/joycon2_connector/lib"
      ],
      "libraries": [
        "<(module_root_dir)/../../joycon2-connector-main/joycon2_connector/lib/ViGEmClient.lib"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": [
            "/Zc:char8_t-",
            "/permissive-",
            "/utf-8"
          ],
          "LanguageStandard": "stdcpp20",
          "ExceptionHandling": 1
        },
        "VCLinkerTool": {
          "AdditionalDependencies": [
            "windowsapp.lib",
            "setupapi.lib",
            "hid.lib"
          ]
        }
      },
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_windows_target_platform_version": "10.0"
          }
        ]
      ]
    }
  ]
}
