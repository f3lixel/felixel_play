const { spawn } = require('child_process');

const args = ['--exec', 'c:/Users/f3lix/OneDrive/Desktop/felixel_play/roms/wii/Disney Epic Mickey 2 - The Power of Two (USA) (En,Fr,Es,Pt).iso'];
const cmd = 'c:/Users/f3lix/OneDrive/Desktop/felixel_play/emulators/dolphin/Dolphin-x64/Dolphin.exe';

const child = spawn(cmd, args, {
  cwd: 'c:/Users/f3lix/OneDrive/Desktop/felixel_play/emulators/dolphin/Dolphin-x64',
  stdio: 'ignore',
  detached: true,
  windowsHide: false
});

child.unref();

console.log('Spawned with PID', child.pid);
