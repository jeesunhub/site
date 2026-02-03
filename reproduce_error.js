const http = require('http');

const payload = JSON.stringify({
    id: undefined,
    password: '1234',
    nickname: '정하준',
    role: 'tenant',
    birth_date: '1986-10-19',
    phone_number: '01080516599',
    building_id: '1',
    login_id: '정하준861019'
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/users/quick',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(payload);
req.end();
