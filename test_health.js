async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/health');
        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body:', text);
    } catch (err) {
        console.error('Test failed:', err.message);
    }
}

test();
