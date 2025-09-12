import { form, resultDiv, roiResultElement, paybackResultElement, chartContainer, inputs } from './domElements.js';
import { calculateROI, calculatePaybackPeriod } from './calculator.js';

let roiChart = null; // To hold the chart instance

form.addEventListener('submit', function(event) {
    event.preventDefault();

    // 1. Get and parse input values
    const inputData = {
        systemCost: parseFloat(inputs.systemCost.value),
        batteryCost: parseFloat(inputs.batteryCost.value),
        annualConsumption: parseFloat(inputs.annualConsumption.value),
        solarGeneration: parseFloat(inputs.solarGeneration.value),
        exportRate: parseFloat(inputs.exportRate.value),
        importRate: parseFloat(inputs.importRate.value),
        selfConsumption: parseFloat(inputs.selfConsumption.value),
        degradationRate: parseFloat(inputs.degradationRate.value),
        inflationRate: parseFloat(inputs.inflationRate.value),
        lifespan: parseInt(inputs.lifespan.value, 10)
    };

    // Basic validation
    if (Object.values(inputData).some(isNaN)) {
        alert('Please fill in all fields with valid numbers.');
        return;
    }

    // 2. Perform calculations
    const { annualSavings, cumulativeRoi, totalCost } = calculateROI(inputData);
    const paybackPeriod = calculatePaybackPeriod(annualSavings, totalCost);
    const finalRoi = cumulativeRoi[cumulativeRoi.length - 1];

    // 3. Display results
    roiResultElement.textContent = `Total ROI after ${inputData.lifespan} years: ${finalRoi.toFixed(2)}%`;
    paybackResultElement.textContent = `Payback Period: ${paybackPeriod}`;
    resultDiv.style.display = 'block';

    // 4. Update chart
    updateChart(cumulativeRoi, inputData.lifespan);
});

function updateChart(roiData, lifespan) {
    const labels = Array.from({ length: lifespan }, (_, i) => `Year ${i + 1}`);

    if (roiChart) {
        roiChart.destroy();
    }

    roiChart = new Chart(chartContainer, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cumulative ROI (%)',
                data: roiData,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                fill: true,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'ROI (%)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Year'
                    }
                }
            }
        }
    });
}