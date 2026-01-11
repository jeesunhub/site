async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/rooms/adv');
        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body snippet:', text.substring(0, 100));
    } catch (err) {
        console.error('Test failed:', err.message);
    }
}

test();
