document.getElementById('go').onclick = async () => {
  const cust = document.getElementById('customer').value.trim();
  const f = document.getElementById('fileInput').files[0];
  if (!cust || !f) {
    alert('Please enter customer and select a file.');
    return;
  }
  // 1) Read Excel:
  const data = await f.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, range:3 });
  // 2) Simple “optimizer”: group by box / SKU
  //    *Replace this stub with your real packing logic.*
  const plan = [];
  rows.forEach(r => plan.push({ sku:r[2], box:r[3], qty:r[4] }));
  // 3) Render on page
  const out = document.getElementById('output');
  out.innerHTML = `<h2>Plan for ${cust}</h2><pre>${JSON.stringify(plan, null,2)}</pre>`;
  // 4) Generate PDF
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(`Pallet Plan for ${cust}`, 10, 10);
  doc.setFontSize(12);
  plan.forEach((it,i) => {
    doc.text(`${i+1}. SKU ${it.sku} – Box ${it.box} – Qty ${it.qty}`, 10, 20 + i*7);
  });
  doc.save('pallet-plan.pdf');
};
