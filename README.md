# wintun

LYNX TUN mode on Windows requires wintun.dll from WireGuard.

## Download

1. Go to https://wintun.net
2. Download the latest wintun zip
3. Extract and place the DLLs here:
   - assets/wintun/amd64/wintun.dll  (for x64 Windows)
   - assets/wintun/arm64/wintun.dll  (for ARM64 Windows)

## License

wintun is licensed under the WireGuard License.
See https://wintun.net for details.

## Note

wintun.dll is NOT bundled with LYNX due to licensing.
Users who want TUN mode must download it manually.
Proxy mode and System Proxy mode work without wintun.
