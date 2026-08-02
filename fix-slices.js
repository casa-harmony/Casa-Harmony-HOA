const fs = require('fs');

const files = [
  'frontend-mock/app/(app)/payments/page.tsx',
  'frontend-mock/app/(app)/purchasing/[poId]/page.tsx',
  'frontend-mock/app/(app)/purchasing/page.tsx',
  'frontend-mock/app/(app)/cash/page.tsx',
  'frontend-mock/app/(app)/budgets/page.tsx',
  'frontend-mock/app/(app)/gl/[batchId]/page.tsx',
  'frontend-mock/app/(app)/encumbrance/page.tsx',
  'frontend-mock/app/(app)/documents/page.tsx',
  'frontend-mock/app/(app)/collections/page.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\b([a-zA-Z0-9_.]+)\.slice\(0,\s*8\)/g, '$1?.slice(0, 8) || "Unknown"');
  fs.writeFileSync(file, content);
}
console.log("Done replacing!");
