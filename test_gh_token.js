const { execFile } = require('child_process');

execFile('gh', ['auth', 'token'], { shell: true }, (err, stdout, stderr) => {
    if (err) {
        console.error('Error getting gh token', err.message);
        return;
    }
    console.log('Got GH token: ', stdout.trim().length > 0 ? 'Yes (length: ' + stdout.trim().length + ')' : 'No');
});
