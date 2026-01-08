
const PATTERNS = {
  diceTotal: /Dice\s*Total\s*[:;.]?\s*([+-]?\d+)/i,
  multiplier: /Final\s*Multiplier\s*[:;.]?\s*\+?([\d.]+)/i
};

// Mocking the parsing logic from runOCR
function parseText(text) {
    const normalizedText = text.replace(/\n/g, " ");
    const sentences = normalizedText.split(/(?=If|Prevents)/i);
    const parsedEffects = [];

    sentences.forEach(sentence => {
        const trimmed = sentence.trim();
        if (trimmed.length < 5) return;

        const totalMatch = trimmed.match(PATTERNS.diceTotal);
        const multiMatch = trimmed.match(PATTERNS.multiplier);
        const isPrevents = /prevents/i.test(trimmed);

        if (totalMatch || multiMatch || isPrevents) {
            let effectIndex = trimmed.length;
            if (totalMatch && totalMatch.index < effectIndex) effectIndex = totalMatch.index;
            if (multiMatch && multiMatch.index < effectIndex) effectIndex = multiMatch.index;

            let conditionText = trimmed.substring(0, effectIndex).replace(/[:;.,-]$/, "").trim();

            parsedEffects.push({
                text: trimmed,
                condition: conditionText,
                diceTotal: totalMatch ? parseInt(totalMatch[1]) : 0,
                multiplier: multiMatch ? parseFloat(multiMatch[1]) : 0
            });
        }
    });
    return parsedEffects;
}

// The updated checkCondition logic
const checkCondition = (condition, dice) => {
    const text = condition.toLowerCase().trim();
    if (!text) return true;
    
    const getVal = (idx) => {
        const d = dice[idx];
        return d ? parseInt(d.id) : 0;
    };
    const hasDie = (idx) => !!dice[idx];

    const ordinals = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
    let targetIndices = [];
    
    if (text.includes("all three") || text.includes("all 3")) {
        targetIndices = [0, 1, 2];
    } else {
        Object.keys(ordinals).forEach(ord => {
            if (text.includes(ord)) targetIndices.push(ordinals[ord]);
        });
    }
    
    // Fallback: if no specific ordinal mentioned, but implies group logic
    if (targetIndices.length === 0 && (text.includes("add up to") || text.includes("consecutive"))) {
            dice.forEach((_, i) => targetIndices.push(i));
    }

    // "Match" logic
    if (text.includes("match")) {
        if (targetIndices.length < 2) return false;
        if (!targetIndices.every(hasDie)) return false;
        const firstVal = getVal(targetIndices[0]);
        return targetIndices.every(idx => getVal(idx) === firstVal);
    }

    // "Roll a X" logic
    const rollMatch = text.match(/roll(?:s)? a\s*(\d+)/);
    if (rollMatch) {
        const targetVal = parseInt(rollMatch[1]);
        // If specific dice specified (e.g. "first die rolls a 4"), check them.
        // If NO specific dice specified (e.g. "If a die rolls a 4"), check ANY die.
        
        if (targetIndices.length > 0) {
            // Check specific indices
            if (!targetIndices.every(hasDie)) return false;
            return targetIndices.every(idx => getVal(idx) === targetVal);
        } else {
            // Check if ANY die matches
            return dice.some(d => parseInt(d.id) === targetVal);
        }
    }

    // "Add up to" logic
    if (text.includes("add up to")) {
        const sumMatch = text.match(/add up to\s*(\d+)/);
        const targetSum = sumMatch ? parseInt(sumMatch[1]) : 0;
        
        if (targetIndices.length === 0) return false; 
        if (!targetIndices.every(hasDie)) return false;

        const currentSum = targetIndices.reduce((acc, idx) => acc + getVal(idx), 0);
        return currentSum >= targetSum; // Usually "X or more" implied or explicit
    }

    return true;
};

// --- Test Cases ---
const inputSentences = [
    "If a die rolls a 4, Final Multiplier: +1.4x",
    "If a die rolls a 5, Dice Total: +3",
    "If the first and third dice match, Final Multiplier: +1.6x",
    "If the first and third dice add up to 2 or more, Dice Total: +9"
];

const mockDiceScenarios = [
    { name: "Dice: [4, 1, 4]", dice: [{id: 4}, {id: 1}, {id: 4}] },
    { name: "Dice: [5, 5, 2]", dice: [{id: 5}, {id: 5}, {id: 2}] },
    { name: "Dice: [1, 2, 3]", dice: [{id: 1}, {id: 2}, {id: 3}] }
];

console.log("=== Parsing Results ===");
const parsedEffects = [];
inputSentences.forEach(text => {
    const effects = parseText(text);
    effects.forEach(e => {
        parsedEffects.push(e);
        console.log(`[Input]: "${text}"`);
        console.log(`  -> Condition: "${e.condition}"`);
        console.log(`  -> Total: ${e.diceTotal}, Multiplier: ${e.multiplier}`);
    });
});

console.log("\n=== Logic Verification ===");
parsedEffects.forEach(effect => {
    console.log(`\nEffect: "${effect.condition}"`);
    mockDiceScenarios.forEach(scenario => {
        const isActive = checkCondition(effect.condition, scenario.dice);
        console.log(`  [${scenario.name}] -> Active: ${isActive}`);
    });
});
