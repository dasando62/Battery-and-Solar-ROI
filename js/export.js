// js/export.js
// Version 1.5.1 (Final)

import { state } from './state.js';
import { 
    renderDebugDataTable, 
    renderNewSystemDebugTable, 
    renderProvidersDebugTable 
} from './debugTables.js';

// --- HELPER FUNCTIONS ---

async function prepareAppendicesForPdf(state) {
    await new Promise(resolve => {
        renderDebugDataTable(state, false);
        renderNewSystemDebugTable(state, false);
        renderProvidersDebugTable(state, false);
        setTimeout(resolve, 200); 
    });
}

function addHeaderFooter(pdf, pageNum, today) {
    const pdfMargin = 30;
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text('Home Solar & Battery ROI Analysis', pdfMargin, pdfMargin - 10);
    pdf.text(`Page ${pageNum}`, pageWidth - pdfMargin, pdfMargin - 10, { align: 'right' });
    pdf.text(`Generated on ${today} by ROI Analyzer v1.5.1`, pdfMargin, pageHeight - (pdfMargin - 15));
}

async function addElementToPdf(pdf, element, yPosition) {
    const pdfMargin = 30;
    if (!element || (element.innerHTML && element.innerHTML.trim().length < 10 && element.tagName !== 'CANVAS')) return yPosition;

    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 100)));
    
    const contentWidth = pdf.internal.pageSize.getWidth() - (pdfMargin * 2);
    
    try {
        const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff', logging: false });
        
        if (canvas.height === 0 || canvas.width === 0) {
            console.warn("Skipping element for PDF export because it rendered with zero height/width:", element);
            return yPosition;
        }

        const imgData = canvas.toDataURL('image/png');
        const imgHeight = canvas.height * contentWidth / canvas.width;

        if (yPosition + imgHeight > pdf.internal.pageSize.getHeight() - pdfMargin * 2) {
            pdf.addPage();
            yPosition = pdfMargin;
            addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), new Date().toLocaleDateString('en-AU', { year: 'numeric', month: '2-digit', day: '2-digit' }));
        }
        pdf.addImage(imgData, 'PNG', pdfMargin, yPosition, contentWidth, imgHeight);
        return yPosition + imgHeight + 20;

    } catch (e) {
        console.error("Error capturing element for PDF. This element will be skipped.", e);
        console.error("Problematic Element:", element);
        return yPosition;
    }
}

async function addChartToPdf(pdf, today) {
    if (!state.savingsChart) return;

    const pdfMargin = 30;
    await new Promise(resolve => requestAnimationFrame(resolve));
    pdf.addPage('a4', 'landscape');
    const pageNum = pdf.internal.getNumberOfPages();
    addHeaderFooter(pdf, pageNum, today);
    const landscapeContentWidth = pdf.internal.pageSize.getWidth() - (pdfMargin * 2);
    const yPosition = pdfMargin + 20;

    pdf.setFontSize(16);
    pdf.text("Financial Analysis: Cumulative Savings Over Time", pdf.internal.pageSize.getWidth() / 2, yPosition - 5, { align: 'center' });
    
    const imgData = state.savingsChart.toBase64Image();
    const imgProps = pdf.getImageProperties(imgData);
    const imgHeight = imgProps.height * landscapeContentWidth / imgProps.width;
    pdf.addImage(imgData, 'PNG', pdfMargin, yPosition, landscapeContentWidth, imgHeight);
}


// --- REPORT GENERATOR FUNCTIONS ---
async function generateManualModeReport(pdf, commonData) {
    const { reportContainer, executiveSummaryHTML, today } = commonData;
    let yPos = 30;
    reportContainer.innerHTML = `
        <h1>Home Solar & Battery ROI Analysis</h1>
        <p style="text-align: center;">Generated on: ${today}</p>
        <p style="text-align: center; font-style: italic;">Mode: Manual Averages</p>
        ${executiveSummaryHTML}`;
    yPos = await addElementToPdf(pdf, reportContainer, yPos);
    const summaryEl = document.getElementById('roiSummary').cloneNode(true);
    const tableEl = document.getElementById('results').cloneNode(true);
    reportContainer.innerHTML = '<h2>Financial Analysis</h2>';
    reportContainer.appendChild(summaryEl);
    reportContainer.appendChild(tableEl);
    yPos = await addElementToPdf(pdf, reportContainer, yPos);
    
    await addChartToPdf(pdf, today);

    const rawDataEl = document.getElementById('raw-data-debug-container');
    if (rawDataEl && rawDataEl.innerHTML.trim().length > 10) {
        pdf.addPage('a4', 'portrait');
        yPos = 30;
        addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), today);
        const rawDataClone = rawDataEl.cloneNode(true);
        rawDataClone.style.display = 'block';
        reportContainer.innerHTML = `<h2>Appendix A: System Performance (Year 1)</h2>`;
        reportContainer.appendChild(rawDataClone);
        await addElementToPdf(pdf, reportContainer, yPos);
    }
}

async function generateCsvModeReport(pdf, commonData, config) {
    const { reportContainer, executiveSummaryHTML, today } = commonData;
    let yPos = 30;
    let totalGridImports = 0, totalGridExports = 0, totalSolarGeneration = 0, totalDays = 0;
    const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
    state.electricityData.forEach(day => {
        const hourlySolar = solarDataMap.get(day.date);
        if (hourlySolar) {
            totalDays++;
            totalSolarGeneration += hourlySolar.reduce((a, b) => a + b, 0);
            totalGridImports += day.consumption.reduce((a, b) => a + b, 0);
            totalGridExports += day.feedIn.reduce((a, b) => a + b, 0);
        }
    });
    const totalSelfConsumed = totalSolarGeneration - totalGridExports;
    const totalConsumption = totalSelfConsumed + totalGridImports;
    const baselineAnalysisHtml = `<h4 style="margin-top:20px;">Baseline Data Analysis (from CSV)</h4><table class="summary-table"><tbody>
        <tr><td>Total Days Analyzed</td><td>${totalDays} days</td></tr>
        <tr><td>Total Consumption (Grid Imports + Self-Consumed Solar)</td><td>${totalConsumption.toFixed(2)} kWh</td></tr>
        <tr><td>Total Solar Generation</td><td>${totalSolarGeneration.toFixed(2)} kWh</td></tr>
        <tr><td>Total Self-Consumed Solar (Generation - Exports)</td><td>${totalSelfConsumed.toFixed(2)} kWh</td></tr>
        <tr><td>Total Imported from Grid (from Usage CSV)</td><td>${totalGridImports.toFixed(2)} kWh</td></tr>
        <tr><td>Total Exported to Grid (from Usage CSV)</td><td>${totalGridExports.toFixed(2)} kWh</td></tr>
    </tbody></table>`;
    reportContainer.innerHTML = `
        <h1>Home Solar & Battery ROI Analysis</h1>
        <p style="text-align: center;">Generated on: ${today}</p>
        <p style="text-align: center; font-style: italic;">Mode: CSV Data</p>
        ${executiveSummaryHTML}
        <h2>1. System Assumptions</h2>
        <h4>Existing System Configuration</h4>
        <table class="summary-table"><tbody>
            <tr><td>Solar Panel Size (kW)</td><td>${config.existingSolarKW}</td></tr>
            <tr><td>System Age (Years)</td><td>${config.existingSystemAge}</td></tr>
            <tr><td>Battery Size (kWh)</td><td>${config.existingBattery}</td></tr>
        </tbody></table>
        ${baselineAnalysisHtml}
        <h4>Proposed New/Replacement System</h4>
        <table class="summary-table"><tbody>
            <tr><td>Additional Solar (kW) & Cost</td><td>${config.newSolarKW} kW at $${config.costSolar}</td></tr>
            <tr><td>Additional Battery (kWh) & Cost</td><td>${config.newBatteryKWH} kWh at $${config.costBattery}</td></tr>
            <tr><td>System is a Replacement</td><td>${config.replaceExistingSystem ? 'Yes' : 'No'}</td></tr>
        </tbody></table>`;
    yPos = await addElementToPdf(pdf, reportContainer, yPos);

    const summaryEl = document.getElementById('roiSummary').cloneNode(true);
    const tableEl = document.getElementById('results').cloneNode(true);
    reportContainer.innerHTML = '<h2>Financial Analysis</h2>';
    reportContainer.appendChild(summaryEl);
    reportContainer.appendChild(tableEl);
    yPos = await addElementToPdf(pdf, reportContainer, yPos);

    await addChartToPdf(pdf, today);
    
    // Appendices
    const rawDataEl = document.getElementById('raw-data-debug-container');
    if (rawDataEl && rawDataEl.innerHTML.trim().length > 10) {
        pdf.addPage('a4', 'portrait');
        yPos = 30;
        addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), today);
        reportContainer.innerHTML = `<h2>Appendix A: System Performance (Year 1)</h2>`;
        const contentClone = rawDataEl.cloneNode(true);
        contentClone.style.display = 'block';
        reportContainer.appendChild(contentClone);
        yPos = await addElementToPdf(pdf, reportContainer, yPos);
    }

    pdf.addPage('a4', 'portrait');
    yPos = 30;
    addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), today);
    reportContainer.innerHTML = `<h2>Appendix B: Provider Tariff Details</h2>`;
    yPos = await addElementToPdf(pdf, reportContainer, yPos);
    for (const provider of config.providers) {
        reportContainer.innerHTML = `<div class="provider-details-report"><h3>${provider.name}</h3><table class="summary-table"><tbody>
            <tr><td>Daily Charge</td><td>$${provider.dailyCharge.toFixed(4)}</td></tr>
            <tr><td>Monthly Fee</td><td>$${provider.monthlyFee.toFixed(2)}</td></tr>
            <tr><td>Rebate</td><td>$${provider.rebate.toFixed(2)}</td></tr>
            <tr><td>Grid Charging Enabled</td><td>${provider.gridChargeEnabled ? `Yes (${provider.gridChargeStart}:00 - ${provider.gridChargeEnd}:00)` : 'No'}</td></tr>
        </tbody></table><h4>Import Rules</h4><table><thead><tr><th>Name</th><th>Type</th><th>Rate</th><th>Hours / Limit</th></tr></thead><tbody>
        ${(provider.importRules || []).map(r => `<tr><td>${r.name}</td><td>${r.type}</td><td>$${r.rate.toFixed(4)}</td><td>${r.type === 'tou' ? r.hours : r.type === 'tiered' ? `${r.limit} kWh` : 'N/A'}</td></tr>`).join('')}
        </tbody></table><h4>Export Rules</h4><table><thead><tr><th>Name</th><th>Type</th><th>Rate</th><th>Hours / Limit</th></tr></thead><tbody>
        ${(provider.exportRules || []).map(r => `<tr><td>${r.name}</td><td>${r.type}</td><td>$${r.rate.toFixed(4)}</td><td>${r.type === 'tou' ? r.hours : r.type === 'tiered' ? `${r.limit} kWh` : 'N/A'}</td></tr>`).join('')}
        </tbody></table></div>`;
        yPos = await addElementToPdf(pdf, reportContainer, yPos);
    }

    const sizingEl = document.getElementById('sizing-recommendation-section');
    if (sizingEl && sizingEl.innerHTML.trim().length > 10) {
        pdf.addPage('a4', 'portrait');
        yPos = 30;
        addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), today);
        
        const contentClone = sizingEl.cloneNode(true);
        contentClone.style.display = 'block';
        const chartsInClone = contentClone.querySelectorAll('canvas');
        chartsInClone.forEach(chartEl => chartEl.parentElement.remove());

        reportContainer.innerHTML = `<h2>Appendix C: Battery Sizing Recommendations</h2>`;
        reportContainer.appendChild(contentClone);
        yPos = await addElementToPdf(pdf, reportContainer, yPos);
        
        // --- FIX #1: Logic to prevent orphaned chart titles ---
        const addChartDirectly = async (chartInstance, title) => {
            if (!chartInstance) return yPos;

            // First, measure the height of the title and the chart
            reportContainer.innerHTML = `<h4>${title}</h4>`;
            const titleCanvas = await html2canvas(reportContainer, { scale: 2 });
            const contentWidth = pdf.internal.pageSize.getWidth() - (60); // 30*2 for margins
            const titleHeight = titleCanvas.height * contentWidth / titleCanvas.width;

            const imgData = chartInstance.canvas.toDataURL('image/png');
            const imgProps = pdf.getImageProperties(imgData);
            const imgHeight = imgProps.height * contentWidth / imgProps.width;

            // Check if BOTH will fit on the page
            if (yPos + titleHeight + imgHeight > pdf.internal.pageSize.getHeight() - 60) {
                pdf.addPage();
                yPos = 30;
                addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), today);
            }

            // Now, add them
            yPos = await addElementToPdf(pdf, reportContainer, yPos); // Add the title
            pdf.addImage(imgData, 'PNG', 30, yPos, contentWidth, imgHeight); // Add the chart
            return yPos + imgHeight + 20;
        };
        yPos = await addChartDirectly(state.peakPeriodChart, 'Daily Peak Period Load Distribution');
        yPos = await addChartDirectly(state.maxHourlyChart, 'Daily Maximum Hourly Load Distribution');
    }

    const providerDebugEl = document.getElementById('providersDebugTableContainer');
    if (providerDebugEl && providerDebugEl.innerHTML.trim().length > 10) {
        pdf.addPage('a4', 'portrait');
        yPos = 30;
        addHeaderFooter(pdf, pdf.internal.getNumberOfPages(), today);
        reportContainer.innerHTML = `<h2>Appendix D: Provider Simulation Averages</h2>`;
        yPos = await addElementToPdf(pdf, reportContainer, yPos);

        // --- FIX #2: Group headings and tables to prevent orphans ---
        const householdTable = providerDebugEl.querySelector('table');
        if (householdTable) {
            reportContainer.innerHTML = '';
            reportContainer.appendChild(householdTable.cloneNode(true));
            yPos = await addElementToPdf(pdf, reportContainer, yPos);
        }

        const providerHeadings = providerDebugEl.querySelectorAll('h4');
        for (const heading of providerHeadings) {
            const table = heading.nextElementSibling;
            reportContainer.innerHTML = ''; // Clear the temp container
            reportContainer.appendChild(heading.cloneNode(true)); // Add heading
            if (table && table.tagName === 'TABLE') {
                reportContainer.appendChild(table.cloneNode(true)); // Add its table
            }
            // Add the combined block to the PDF
            yPos = await addElementToPdf(pdf, reportContainer, yPos);
        }
    }
}

// --- MAIN EXPORT FUNCTIONS ---
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

export async function exportPdf() {
    if (!state.analysisResults || !state.analysisConfig) {
        alert("Please run an analysis before exporting.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const exportButton = document.getElementById('exportPdf');
    const originalButtonText = exportButton.textContent;
    const reportContainer = document.getElementById('pdf-report-generator');
    
    exportButton.textContent = 'Generating...';
    exportButton.disabled = true;

    try {
        const config = state.analysisConfig;
        const results = state.analysisResults;
        const today = new Date().toLocaleDateString('en-AU', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const isManualMode = !state.electricityData || state.electricityData.length === 0;

        if (Chart.defaults.animation) Chart.defaults.animation.duration = 0;
        
        if (!isManualMode) {
            await prepareAppendicesForPdf(state);
        }
        
        let best = {
            payback: { value: Infinity, id: null },
            npv: { value: -Infinity, id: null },
            irr: { value: -Infinity, id: null }
        };

        config.selectedProviders.forEach(pKey => {
            const res = results[pKey];
            if (!res) return;
            const providerDetails = config.providers.find(p => p.id === pKey);
            const systemCostForProvider = config.initialSystemCost - (providerDetails?.rebate || 0);
            const finalNPV = res.npv - systemCostForProvider;

            if (res.roiYear && res.roiYear < best.payback.value) {
                best.payback.value = res.roiYear;
                best.payback.id = pKey;
            }
            if (finalNPV > best.npv.value) {
                best.npv.value = finalNPV;
                best.npv.id = pKey;
            }
            if (res.irr > best.irr.value) {
                best.irr.value = res.irr;
                best.irr.id = pKey;
            }
        });

        const bestPaybackProvider = config.providers.find(p => p.id === best.payback.id)?.name || 'N/A';
        const bestNpvProvider = config.providers.find(p => p.id === best.npv.id)?.name || 'N/A';
        const bestIrrProvider = config.providers.find(p => p.id === best.irr.id)?.name || 'N/A';

        let npvRow = '<tr><td>Best Net Present Value (NPV)</td><td>Not Calculated</td><td>(Enable to see result)</td></tr>';
        if (config.discountRateEnabled) { 
            npvRow = `<tr><td>Best Net Present Value (NPV)</td><td>$${best.npv.value > -Infinity ? best.npv.value.toFixed(2) : 'N/A'}</td><td>(${bestNpvProvider})</td></tr>`; 
        }
        const paybackRow = `<tr><td>Best Payback Period</td><td>${best.payback.value < Infinity ? `${best.payback.value} Years` : `> ${config.numYears}`}</td><td>(${bestPaybackProvider})</td></tr>`;
        const irrRow = `<tr><td>Best Internal Rate of Return (IRR)</td><td>${best.irr.value > -Infinity ? `${best.irr.value.toFixed(2)}%` : 'N/A'}</td><td>(${bestIrrProvider})</td></tr>`;
        
        const executiveSummaryHTML = `<h2 style="margin-top: 50px;">Executive Summary</h2>
            <table class="summary-table"><tbody>
                ${paybackRow}
                ${npvRow}
                ${irrRow}
            </tbody></table>`;
        
        const commonData = { reportContainer, executiveSummaryHTML, today };

        addHeaderFooter(pdf, 1, today);

        if (isManualMode) {
            await generateManualModeReport(pdf, commonData);
        } else {
            await generateCsvModeReport(pdf, commonData, config);
        }
        
        pdf.save(`ROI-Analysis-Report-${today.replace(/\//g, '-')}.pdf`);

    } catch (error) {
        console.error("Failed to generate PDF:", error);
        alert("An error occurred while generating the PDF. Please check the console.");
    } finally {
        if (Chart.defaults.animation) Chart.defaults.animation.duration = 400;
        exportButton.textContent = originalButtonText;
        exportButton.disabled = false;
        reportContainer.innerHTML = '';
    }
}