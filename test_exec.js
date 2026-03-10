const { exec, execFile } = require('child_process');

console.log('ENV COMSPEC:', process.env.COMSPEC);
console.log('ENV PATH:', process.env.PATH);

exec('git --version', (err, stdout, stderr) => {
    console.log('exec git --version:', err ? err.message : stdout.trim());
});

execFile('git', ['--version'], (err, stdout, stderr) => {
    console.log('execFile git --version:', err ? err.message : stdout.trim());
});

exec('git --version', { shell: 'powershell.exe' }, (err, stdout, stderr) => {
    console.log('exec git --version (powershell):', err ? err.message : stdout.trim());
});
