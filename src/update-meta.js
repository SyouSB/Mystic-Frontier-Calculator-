const fs = require('fs');
const path = require('path');

const indexPath = path.resolve(__dirname, '..', 'public', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

const ogTags = `
    <meta property="og:title" content="Mystic Frontier Calculator" />
    <meta property="og:description" content="Automated score calculator for Mystic Frontier using screen analysis." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://SyouSB.github.io/Mystic-Frontier-Calculator-/">
`;

if (!content.includes('og:title')) {
    content = content.replace('</head>', ogTags + '\n  </head>');
}

fs.writeFileSync(indexPath, content);
console.log('Successfully updated index.html with OG tags');
