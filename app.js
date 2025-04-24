// frontend/app.js
// Ensure you've loaded xlsx.full.min.js in index.html!

document.getElementById('go').addEventListener('click', async () => {
  const customer = document.getElementById('customer').value.trim();
  const fileInput = document.getElementById('fileInput');
  if (!customer || !fileInput.files.length) {
    alert('Please enter a customer name and select an .xlsx file.');
    return;
  }

  // 1) Read the Excel file
  const data = await fileInput.files[0].arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // skip first 3 header rows
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  // 2) Build a flat “Pallet 1 → Layer 1” list
  const items = rows
    .filter(r => r[2])             // only rows with SKU
    .map(r => ({                   // map to SKU/name/box
      sku:   r[2].trim(),
      name:  r[3].trim(),
      box:   r[4].trim()
    }));

  // 3) Render HTML exactly as requested
  let html = `<h2>PALLET 1</h2>`;
  html += `<h3>Layer 1</h3><ul>`;
  items.forEach(it => {
    html += `<li>${it.sku} | ${it.name} | ${it.box}</li>`;
  });
  html += `</ul>`;
  html += `<p><strong>SUMMARY PALLET 1:</strong> ${items.length} boxes</p>`;
  html += `<h3>TOTAL: 1 pallet | ${items.length} boxes</h3>`;

  document.getElementById('output').innerHTML = html;
});
