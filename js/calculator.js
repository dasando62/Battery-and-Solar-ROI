/**
 * Calculates the annual savings and cumulative ROI over the system's lifespan.
 * @param {object} data - The input data from the form.
 * @returns {object} - An object containing arrays for annual savings and cumulative ROI.
 */
export function calculateROI(data) {
    const {
        systemCost,
        batteryCost,
        annualConsumption,
        solarGeneration,
        exportRate,
        importRate,
        selfConsumption,
        degradationRate,
        inflationRate,
        lifespan
    } = data;

    const totalCost = systemCost + batteryCost;
    const annualSavings = [];
    const cumulativeRoi = [];
    let cumulativeSavings = 0;

    for (let year = 1; year <= lifespan; year++) {
        const currentGeneration = solarGeneration * Math.pow(1 - degradationRate / 100, year - 1);
        const currentImportRate = importRate * Math.pow(1 + inflationRate / 100, year - 1);
        const currentExportRate = exportRate * Math.pow(1 + inflationRate / 100, year - 1);

        const solarUsed = currentGeneration * (selfConsumption / 100);
        const solarExported = currentGeneration - solarUsed;
        const gridImport = annualConsumption - solarUsed;

        const savingsOnImport = solarUsed * currentImportRate;
        const earningsOnExport = solarExported * currentExportRate;
        const costOfGridImport = gridImport > 0 ? gridImport * currentImportRate : 0;

        const annualSaving = savingsOnImport + earningsOnExport;
        annualSavings.push(annualSaving);

        cumulativeSavings += annualSaving;
        const roi = ((cumulativeSavings - totalCost) / totalCost) * 100;
        cumulativeRoi.push(roi);
    }

    return { annualSavings, cumulativeRoi, totalCost };
}

/**
 * Calculates the simple payback period.
 * @param {number[]} annualSavings - Array of savings per year.
 * @param {number} totalCost - The total initial investment.
 * @returns {string} - The payback period in years and months.
 */
export function calculatePaybackPeriod(annualSavings, totalCost) {
    let cumulativeSavings = 0;
    for (let year = 0; year < annualSavings.length; year++) {
        cumulativeSavings += annualSavings[year];
        if (cumulativeSavings >= totalCost) {
            const remainingCost = totalCost - (cumulativeSavings - annualSavings[year]);
            const months = Math.ceil((remainingCost / annualSavings[year]) * 12);
            return `${year} years and ${months} months`;
        }
    }
    return "Over system lifespan";
}