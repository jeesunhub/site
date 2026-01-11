const fetch = require('node-fetch');

async function testLedger() {
    try {
        const response = await fetch('http://localhost:3000/api/payments/ledger?role=admin&user_id=1');
        const data = await response.json();
        console.log(JSON.stringify(data[0], null, 2));
    } catch (err) {
        console.error('Fetch error:', err.message);
    }
}

testLedger();
