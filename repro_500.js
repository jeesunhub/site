const http = require('http');

// Mock data based on item_adv.html
const data = {
    created_by: "1", // Assuming user.id = 1
    type: "item",
    building_id: "1", // Assuming buildingId = 1
    title: "Repro Ad Title",
    item_name: "Repro Item Name",
    price: "1000",
    description: "Repro description",
    is_anonymous: "false",
    target_id: "" // Public
};

// We use multipart/form-data for ads because of photo uploads
// But for reproduction, we can try to send it as JSON if the server supports it (Express body-parser)
// Wait, the server uses 'upload.array', which means it expects multipart/form-data.

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
let body = '';

for (const key in data) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${data[key]}\r\n`;
}
body += `--${boundary}--\r\n`;

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/ads',
    method: 'POST',
    headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body)
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

req.write(body);
req.end();
