const fs = require('fs');
const files = [
  { path: 'frontend-mock/app/(app)/cash/page.tsx', stage: 'LEDGER' },
  { path: 'frontend-mock/app/(app)/payables/page.tsx', stage: 'MASTERS' },
  { path: 'frontend-mock/app/(app)/purchasing/page.tsx', stage: 'MASTERS' },
  { path: 'frontend-mock/app/(app)/statements/page.tsx', stage: 'SUBLEDGER' },
  { path: 'frontend-mock/app/(app)/collections/page.tsx', stage: 'SUBLEDGER' },
  { path: 'frontend-mock/app/(app)/budgets/page.tsx', stage: 'LEDGER' },
  { path: 'frontend-mock/app/(app)/fixed-assets/page.tsx', stage: 'LEDGER' }
];

for (const {path, stage} of files) {
  let content = fs.readFileSync(path, 'utf8');
  
  // Add import
  if (!content.includes('ReadinessEmptyState')) {
    content = content.replace(/import {([^}]+)} from "@\/components\/ui";/, 'import { $1 } from "@/components/ui";\nimport { ReadinessEmptyState } from "@/components/readiness";');
  }
  
  // Replace return ( <div className="space-y-5"> ... ); with const content = ... return <ReadinessEmptyState ... />
  const returnRegex = /return \(\s*(<div className="space-y-5">[\s\S]+?)\s*\);\s*\}\s*$/;
  content = content.replace(returnRegex, (match, divContent) => {
    return `const content = (\n    ${divContent}\n  );\n\n  return <ReadinessEmptyState requiredStage="${stage}" fallback={content} />;\n}\n`;
  });
  
  fs.writeFileSync(path, content);
}
