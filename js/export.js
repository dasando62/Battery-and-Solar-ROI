// js/export.js
//Version 1.0.9
import { state } from './state.js';

export function exportCsv() {
  const { analysisResults, analysisConfig } = state;

  if (!analysisResults || !analysisConfig) {
    alert("Please run an analysis before exporting.");
    return;
  }

  const baselineProvider = analysisConfig.providers.find(p => p.id === analysisConfig.selectedProviders[0]);
  const baselineName = baselineProvider ? baselineProvider.name : 'Baseline';

  const headers = ["Year", `Baseline Cost (${baselineName})`];
  
  analysisConfig.selectedProviders.forEach(pKey => {
    const provider = analysisConfig.providers.find(p => p.id === pKey);
    const providerName = provider ? provider.name : pKey;
    headers.push(`${providerName} Cost w/ System`, `${providerName} Cumulative Savings`);
  });

  let csvContent = headers.join(",") + "\r\n";

  for (let y = 0; y < analysisConfig.numYears; y++) {
    const yearNum = y + 1;
    const baselineCost = (analysisResults.baselineCosts[yearNum] || 0).toFixed(2);
    const row = [yearNum, baselineCost];

    analysisConfig.selectedProviders.forEach(pKey => {
      const result = analysisResults[pKey];
      if (result) {
        row.push((result.annualCosts[y] || 0).toFixed(2));
        row.push((result.cumulativeSavingsPerYear[y] || 0).toFixed(2));
      } else {
        row.push("0.00", "0.00");
      }
    });
    csvContent += row.join(",") + "\r\n";
  }

  const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
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
