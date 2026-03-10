async function check() {
    try {
        const res = await fetch('http://127.0.0.1:4096/openapi.json');
        console.log("Status:", res.status);
        if (res.ok) {
            console.log("Content:", await res.text());
        }
    } catch (e) {
        console.error(e);
    }
}
check();
