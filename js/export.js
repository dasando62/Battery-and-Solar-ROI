// js/export.js
//Version 9.6
import { state } from './state.js';

export function exportCsv() {
  const analysisResults = state.analysisResults;
  if (!analysisResults) {
    alert("Please run an analysis before exporting.");
    return;
  }
  const analysisConfig = state.analysisConfig;
  const analysisBaselineCosts = state.analysisBaselineCosts;
  const analysisSelectedProviders = state.analysisSelectedProviders;
  let csvContent = "data:text/csv;charset=utf-8,";
  const headers = ["Year", `Baseline Cost (${analysisSelectedProviders[0]})`];
  analysisSelectedProviders.forEach(p => {
    headers.push(`${p} Cost w/ System`, `${p} Cumulative Savings`);
  });
  csvContent += headers.join(",") + "\r\n";
  for (let y = 0; y < analysisConfig.numYears; y++) {
    const row = [y + 1, analysisBaselineCosts[y + 1].toFixed(2)];
    analysisSelectedProviders.forEach(p => {
      row.push(analysisResults[p].annualCosts[y].toFixed(2));
      row.push(analysisResults[p].cumulativeSavingsPerYear[y].toFixed(2));
    });
    csvContent += row.join(",") + "\r\n";
  }
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "roi_results.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportPdf() {
  const analysisResults = state.analysisResults;
  if (!analysisResults) {
    alert("Please run an analysis before exporting.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const resultsSection = document.getElementById("results-section");
  if (!resultsSection) {
    alert("Results section not found.");
    return;
  }
  html2canvas(resultsSection, { scale: 2 }).then(canvas => {
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const imgHeight = canvas.height * pdfWidth / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
    pdf.save("roi_results.pdf");
  });
}
