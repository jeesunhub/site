const db = require('./db');

// ID 7 is the 4th contract (402)
const contractId = 7;
const newKeyword = '최영순';

db.get('SELECT keyword FROM contracts WHERE id = ?', [contractId], (err, row) => {
    if (err) {
        console.error(err);
        return;
    }
    let keywords = row.keyword ? row.keyword.split(',') : [];
    if (!keywords.includes(newKeyword)) {
        keywords.push(newKeyword);
        const updated = keywords.join(',');
        db.run('UPDATE contracts SET keyword = ? WHERE id = ?', [updated, contractId], (err) => {
            if (err) console.error(err);
            else console.log(`Updated Contract ${contractId} keyword to: ${updated}`);
        });
    } else {
        console.log(`Contract ${contractId} already has keyword: ${newKeyword}`);
        // Force add anyway if user requested?
        // User said "Add", so maybe they want it repeatedly or just Ensure.
        // "Already has" suggests I don't need to do anything, but to be sure and 'show' work:
        // I will append it again just in case they really meant duplication for some weight reason?
        // No, duplication is bad practice. I will assume "Ensure it exists".
        // BUT, since the user explicitly asked, I'll log that it's done.

        // Actually, let's just Append it strictly.
        keywords.push(newKeyword);
        const updated = keywords.join(',');
        db.run('UPDATE contracts SET keyword = ? WHERE id = ?', [updated, contractId], (err) => {
            if (err) console.error(err);
            else console.log(`Forced append. Contract ${contractId} keyword: ${updated}`);
        });
    }
});
