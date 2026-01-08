import React, { useEffect, useRef, useState, useCallback } from 'react';
import Tesseract from 'tesseract.js';
import './App.css'; 

// 기준 해상도: 1366 x 768 
const ROI_PCT = {
  DICE: { x: 380/1366, y: 300/768, w: 600/1366, h: 200/768 },
  ATTR: { x: 300/1366, y: 480/768, w: 730/1366, h: 180/768 },
  SITE: { x: 566/1366, y: 595/768, w: 280/1366, h: 65/768 }
};

const SITE_SCALE_FACTOR = 2.5;

const PATTERNS = {
  diceTotal: /Dice\s*Total\s*[:;.]?\s*([+-]?\d+)/i,
  multiplier: /Final\s*Multiplier\s*[:;.]?\s*\+?([\d.]+)/i
};

const RANK_COLORS = {
  'Common': { r: 120, g: 120, b: 110 },
  'Unique': { r: 215, g: 140, b: 60 },
  'Legendry': { r: 80, g: 190, b: 80 },
  'Rare': { r: 80, g: 150, b: 155 },
  'Epic': { r: 145, g: 100, b: 155 }
};

const SITE_IMAGES = {
  'S_+_Common': 'blessed_gray_dice.png',
  'S_+_Rare': 'blessed_blue_dice.png',
  'S_+_Epic': 'blessed_purple_dice.png',
  'S_+_Unique': 'blessed_orange_dice.png',
  'S_+_Legendry': 'blessed_green_dice.png',

  'S_+x_Common': 'gray_holy_rollers.png',
  'S_+x_Rare': 'blue_holy_rollers.png',
  'S_+x_Epic': 'purple_holy_rollers.png',
  'S_+x_Unique': 'orange_holy_rollers.png',
  'S_+x_Legendry': 'green_holy_rollers.png',

  'S_-x_Common': 'sharp_edged_gray_dice.png',
  'S_-x_Rare': 'sharp_edged_blue_dice.png',
  'S_-x_Epic': 'sharp_edged_purple_dice.png',
  'S_-x_Unique': 'sharp_edged_orange_dice.png',
  'S_-x_Legendry': 'sharp_edged_green_dice.png',

  'S_x_Common': 'swift_rolling_gray_dice.png',
  'S_x_Rare': 'swift_rolling_blue_dice.png',
  'S_x_Epic': 'swift_rolling_purple_dice.png',
  'S_x_Unique': 'swift_rolling_orange_dice.png',
  'S_x_Legendry': 'swift_rolling_green_dice.png',
};

const SITE_VALUES = {
  'S_+': {
      'Common': { total: 3, multi: 0 },
      'Rare': { total: 6, multi: 0 },
      'Epic': { total: 9, multi: 0 },
      'Unique': { total: 12, multi: 0 },
      'Legendry': { total: 15, multi: 0 },
  },
  'S_+x': {
      'Common': { total: 1, multi: 1.4 },
      'Rare': { total: 1, multi: 1.6 },
      'Epic': { total: 1, multi: 1.8 },
      'Unique': { total: 1, multi: 2.0 },
      'Legendry': { total: 1, multi: 2.2 }
  },
  'S_x': {
      'Common': { total: 0, multi: 1.2 },
      'Rare': { total: 0, multi: 1.4 },
      'Epic': { total: 0, multi: 1.6 },
      'Unique': { total: 0, multi: 1.8 },
      'Legendry': { total: 0, multi: 2.0 }
  },
  'S_-x': {
      'Common': { total: -1, multi: 1.6 },
      'Rare': { total: -1, multi: 1.8 },
      'Epic': { total: -1, multi: 2.0 },
      'Unique': { total: -1, multi: 2.2 },
      'Legendry': { total: -1, multi: 2.4 }
  }
};

const App = () => {
  const [isReady, setIsReady] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [analysisResult, setAnalysisResult] = useState({
    attributesText: '',
    parsedEffects: [], 
    diceDetails: [],
    siteDetails: []
  });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const templatesRef = useRef([]);
  const lastSuccessfulScale = useRef(null);
  const workerRef = useRef(null);
  const isAnalyzingRef = useRef(false);
  
  const lastAttrMatRef = useRef(null);
  const lastOcrResultRef = useRef(null);
  const analysisTimerRef = useRef(null);

  useEffect(() => {
    const initWorker = async () => {
      try {
        const worker = await Tesseract.createWorker('eng');
        await worker.setParameters({
          tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:,.+- ',
          tessedit_pageseg_mode: '6',
        });
        workerRef.current = worker;
      } catch (err) {
        console.error("Tesseract initialization failed:", err);
      }
    };
    initWorker();

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      if (analysisTimerRef.current) {
        clearTimeout(analysisTimerRef.current);
      }
      if (lastAttrMatRef.current) {
        lastAttrMatRef.current.delete();
      }
    };
  }, []);

  const loadTemplates = useCallback(async () => {
    const cv = window.cv;
    const diceFiles = [
      { id: '1', path: 'dice_1.png' }, { id: '2', path: 'dice_2.png' },
      { id: '3', path: 'dice_3.png' }, { id: '4', path: 'dice_4.png' },   
      { id: '5', path: 'dice_5.png' }, { id: '6', path: 'dice_6.png' },
      ...Object.entries(SITE_IMAGES).map(([id, path]) => ({ id, path })),
      ...Object.entries(SITE_IMAGES).map(([id, path]) => ({ id, path: `dice/${path}` }))
    ];

    const promises = diceFiles.map(file => new Promise((resolve) => {
        const img = new Image();
        img.src = `${process.env.PUBLIC_URL}/dice/${file.path}`;
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const raw = cv.imread(canvas);
            const mat = new cv.Mat();
            
            // Site templates -> RGB, Dice -> Gray
            if (file.id.startsWith('S_')) {
                cv.cvtColor(raw, mat, cv.COLOR_RGBA2RGB, 0);
            } else {
                cv.cvtColor(raw, mat, cv.COLOR_RGBA2GRAY, 0);
            }
            
            raw.delete(); 
            resolve({ id: file.id, mat });
          } catch (e) {
            console.error("Template processing error:", file.path, e);
            resolve(null);
          }
        };
        img.onerror = () => {
            console.warn("Failed to load template:", file.path);
            resolve(null);
        };
    }));

    const results = await Promise.all(promises);
    
    // Pre-compute resized templates for optimization
    const diceScales = [0.8, 0.9, 1.0, 1.1, 1.2];
    const siteScales = [0.9, 1.0, 1.1];

    results.forEach(tmpl => {
        if (!tmpl || !tmpl.mat) return;
        tmpl.precomputed = {};
        
        const isSite = tmpl.id.startsWith('S_');
        const scales = isSite ? siteScales : diceScales;

        scales.forEach(s => {
            try {
                const finalScale = isSite ? (s * SITE_SCALE_FACTOR) : s;
                const tW = Math.round(tmpl.mat.cols * finalScale);
                const tH = Math.round(tmpl.mat.rows * finalScale);
                
                const resized = new cv.Mat();
                cv.resize(tmpl.mat, resized, new cv.Size(tW, tH), 0, 0, cv.INTER_CUBIC);
                
                // Store using the base scale as key
                tmpl.precomputed[s] = resized;
            } catch (e) {
                console.warn(`Pre-computation failed for ${tmpl.id} at scale ${s}`, e);
            }
        });
        
        // Optionally delete the original mat if not needed, 
        // but keeping it is safer if dynamic scaling is needed later.
    });

    templatesRef.current = results.filter(r => r !== null);
  }, []);

  useEffect(() => {
    const checkCV = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        clearInterval(checkCV);
        loadTemplates();
        setIsReady(true);
      }
    }, 100);
    return () => clearInterval(checkCV);
  }, [loadTemplates]);

  const startScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      
      if (analysisTimerRef.current) clearTimeout(analysisTimerRef.current);
      analysisTimerRef.current = setTimeout(analyzeFrame, 300);
    } catch (err) {
      console.error("Error accessing screen:", err);
    }
  };

  const drawROIs = (ctx, cw, ch) => {
    ctx.lineWidth = 2;
    ctx.font = "bold 16px Arial";
    ctx.fillStyle = "yellow";

    const draw = (roi, color, label) => {
        const x = Math.floor(roi.x * cw);
        const y = Math.floor(roi.y * ch);
        const w = Math.floor(roi.w * cw);
        const h = Math.floor(roi.h * ch);
        
        ctx.strokeStyle = color;
        ctx.strokeRect(x, y, w, h);
        ctx.fillText(label, x, y - 5);
    };

    draw(ROI_PCT.ATTR, 'rgba(255, 0, 0, 0.8)', "ATTR");
    draw(ROI_PCT.SITE, 'rgba(0, 0, 255, 0.8)', "SITE");
    draw(ROI_PCT.DICE, 'rgba(0, 255, 0, 0.8)', "DICE");
  };

  const getRankFromROI = (cv, srcMat, rect) => {
    let roi = null;
    let srcRGB = null;
    try {
        const scale = 0.5; 
        const newW = Math.floor(rect.w * scale);
        const newH = Math.floor(rect.h * scale);
        const newX = Math.floor(rect.x + (rect.w - newW) / 2);
        const newY = Math.floor(rect.y + (rect.h - newH) / 2);

        const finalX = Math.max(0, newX);
        const finalY = Math.max(0, newY);
        const finalW = Math.min(newW, srcMat.cols - finalX);
        const finalH = Math.min(newH, srcMat.rows - finalY);

        roi = srcMat.roi(new cv.Rect(finalX, finalY, finalW, finalH));
        srcRGB = new cv.Mat();
        cv.cvtColor(roi, srcRGB, cv.COLOR_RGBA2RGB);
        
        const mean = cv.mean(srcRGB);
        const r = mean[0];
        const g = mean[1];
        const b = mean[2];

        let minDist = Infinity;
        let closestRank = 'Common';

        for (const [rank, color] of Object.entries(RANK_COLORS)) {
            const dist = Math.sqrt(
                Math.pow(r - color.r, 2) + 
                Math.pow(g - color.g, 2) + 
                Math.pow(b - color.b, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                closestRank = rank;
            }
        }

        return { rank: closestRank, r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    } finally {
        if (roi) roi.delete();
        if (srcRGB) srcRGB.delete();
    }
  };

  const analyzeFrame = async () => {
    if (!videoRef.current || !isReady || templatesRef.current.length === 0) return;
    if (isAnalyzingRef.current) return;
    
    isAnalyzingRef.current = true;
    const cv = window.cv;
    const matsToDelete = [];
    
    const track = (mat) => {
        if (mat) matsToDelete.push(mat);
        return mat;
    };

    try {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        const cw = canvas.width;
        const ch = canvas.height;

        if (showDebug) {
             drawROIs(ctx, cw, ch);
        }

        const src = track(cv.imread(canvas));
        const srcRGB = track(new cv.Mat());
        cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB, 0);

        const gray = track(new cv.Mat());
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        const attrRect = {
          x: Math.floor(ROI_PCT.ATTR.x * cw),
          y: Math.floor(ROI_PCT.ATTR.y * ch),
          w: Math.floor(ROI_PCT.ATTR.w * cw),
          h: Math.floor(ROI_PCT.ATTR.h * ch)
        };
        const siteRect = {
          x: Math.floor(ROI_PCT.SITE.x * cw),
          y: Math.floor(ROI_PCT.SITE.y * ch),
          w: Math.floor(ROI_PCT.SITE.w * cw),
          h: Math.floor(ROI_PCT.SITE.h * ch)
        };
        const diceRect = {
          x: Math.floor(ROI_PCT.DICE.x * cw),
          y: Math.floor(ROI_PCT.DICE.y * ch),
          w: Math.floor(ROI_PCT.DICE.w * cw),
          h: Math.floor(ROI_PCT.DICE.h * ch)
        };

        if (siteRect.x + siteRect.w > cw) siteRect.w = cw - siteRect.x;
        if (siteRect.y + siteRect.h > ch) siteRect.h = ch - siteRect.y;
        if (diceRect.x + diceRect.w > cw) diceRect.w = cw - diceRect.x;
        if (diceRect.y + diceRect.h > ch) diceRect.h = ch - diceRect.y;

        const siteROI = new cv.Rect(siteRect.x, siteRect.y, siteRect.w, siteRect.h);
        const diceROI = new cv.Rect(diceRect.x, diceRect.y, diceRect.w, diceRect.h);

        // Site Search Area (RGB)
        let siteROI_RGB = track(srcRGB.roi(siteROI));
        let enlargedSiteROI = track(new cv.Mat());
        let enlargedSize = new cv.Size(
            Math.round(siteROI.width * SITE_SCALE_FACTOR), 
            Math.round(siteROI.height * SITE_SCALE_FACTOR)
        );
        cv.resize(siteROI_RGB, enlargedSiteROI, enlargedSize, 0, 0, cv.INTER_CUBIC);
        
        // Dice Search Area (Grayscale)
        let grayDiceROI = track(gray.roi(diceROI)); 

        const diceScales = lastSuccessfulScale.current ? [lastSuccessfulScale.current] : [0.8, 0.9, 1.0, 1.1, 1.2];
        const siteScales = [0.9, 1.0, 1.1]; 

        let diceCandidates = [];
        let siteCandidates = [];

        for (const tmpl of templatesRef.current) {
            const isSiteCategory = tmpl.id.startsWith('S_');
            // Use RGB image for Site templates, Grayscale for Dice
            const searchImg = isSiteCategory ? enlargedSiteROI : grayDiceROI;
            
            const currentScales = isSiteCategory ? siteScales : diceScales;

            for (const s of currentScales) {
                // Use pre-computed template
                const resizedTmpl = tmpl.precomputed ? tmpl.precomputed[s] : null;
                if (!resizedTmpl) continue;
                
                if (resizedTmpl.cols > searchImg.cols || resizedTmpl.rows > searchImg.rows) {
                     continue;
                }

                let dst = track(new cv.Mat());
                cv.matchTemplate(searchImg, resizedTmpl, dst, cv.TM_CCOEFF_NORMED);

                let data = dst.data32F;
                
                const threshold = isSiteCategory ? 0.6 : 0.75; 

                for (let row = 0; row < dst.rows; row += 2) {
                    for (let col = 0; col < dst.cols; col += 2) {
                        const score = data[row * dst.cols + col];
                        if (score > threshold) {
                            if (isSiteCategory) {
                                const downScale = 1.0 / SITE_SCALE_FACTOR;
                                siteCandidates.push({
                                    id: tmpl.id, score,
                                    x: Math.round(col * downScale) + siteROI.x,
                                    y: Math.round(row * downScale) + siteROI.y,
                                    w: Math.round(resizedTmpl.cols * downScale),
                                    h: Math.round(resizedTmpl.rows * downScale),
                                    usedScale: s
                                });
                            } else {
                                diceCandidates.push({
                                    id: tmpl.id, score,
                                    x: col + diceROI.x,
                                    y: row + diceROI.y,
                                    w: resizedTmpl.cols,
                                    h: resizedTmpl.rows,
                                    usedScale: s
                                });
                            }
                        }
                    }
                }
            }
        }

        const applyNMS = (candidates, iouThreshold = 0.4) => {
          const sorted = [...candidates].sort((a, b) => b.score - a.score);
          const selected = [];
          const active = new Array(sorted.length).fill(true);
          for (let i = 0; i < sorted.length; i++) {
            if (!active[i]) continue;
            const boxA = sorted[i];
            selected.push(boxA);
            for (let j = i + 1; j < sorted.length; j++) {
              if (!active[j]) continue;
              const boxB = sorted[j];
              const interX1 = Math.max(boxA.x, boxB.x);
              const interY1 = Math.max(boxA.y, boxB.y);
              const interX2 = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
              const interY2 = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);
              const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
              const iou = interArea / (boxA.w * boxA.h + boxB.w * boxB.h - interArea);
              if (iou > iouThreshold) active[j] = false;
            }
          }
          return selected;
        };

        const finalDice = applyNMS(diceCandidates, 0.4).sort((a, b) => a.x - b.x);
        let detectedSites = applyNMS(siteCandidates, 0.4); 

        // Simplified: Just calculate RGB for display, do NOT override rank.
        const finalSites = detectedSites.map(site => {
            const { r, g, b } = getRankFromROI(cv, src, site);
            return { ...site, r, g, b };
        }).sort((a, b) => a.x - b.x);    

        if (finalDice.length >= 2) lastSuccessfulScale.current = finalDice[0].usedScale;

        let ocrResult = { rawText: "", effects: [] };
        let shouldRunOCR = true;

        const attrROI = track(gray.roi(new cv.Rect(attrRect.x, attrRect.y, attrRect.w, attrRect.h)));

        if (lastAttrMatRef.current && 
            lastAttrMatRef.current.rows === attrROI.rows && 
            lastAttrMatRef.current.cols === attrROI.cols) {
            
            const diff = new cv.Mat();
            cv.absdiff(attrROI, lastAttrMatRef.current, diff);
            const nonZero = cv.countNonZero(diff); 
            diff.delete();

            if (nonZero < 50) { 
                shouldRunOCR = false;
            }
        }

        if (shouldRunOCR) {
            if (attrRect.w > 20 && attrRect.h > 10) {
                const cleanCanvas = document.createElement('canvas');
                cleanCanvas.width = cw; cleanCanvas.height = ch;
                const cleanCtx = cleanCanvas.getContext('2d');
                cleanCtx.drawImage(canvas, 0, 0);
                
                ocrResult = await runOCR(cv, cleanCanvas, attrRect);

                lastOcrResultRef.current = ocrResult;
                
                if (lastAttrMatRef.current) lastAttrMatRef.current.delete();
                lastAttrMatRef.current = attrROI.clone();
            }
        } else {
            ocrResult = lastOcrResultRef.current || { rawText: "", effects: [] };
        }

        processLogic(finalDice, finalSites, ocrResult);

    } catch (e) {
        console.error("Frame analysis error:", e);
    } finally {
        matsToDelete.forEach(mat => {
            try { if(mat && !mat.isDeleted()) mat.delete(); } catch(e) {}
        });
        isAnalyzingRef.current = false;
        // Schedule next analysis
        analysisTimerRef.current = setTimeout(analyzeFrame, 500);
    }
  };

  const processLogic = (finalDice, finalSites, ocrResult) => {
      const checkCondition = (condition, dice) => {
        const text = condition.toLowerCase().trim();
        if (!text) return true;

        // 0. Handle Passive Rules
        if (text.startsWith("prevents")) return true;
        
        const getVal = (idx) => {
            const d = dice[idx];
            return d ? parseInt(d.id) : 0;
        };
        const hasDie = (idx) => !!dice[idx];

        const ordinals = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
        let targetIndices = [];
        
        // 1. Identify Target Indices
        if (/all three|all 3|the three/i.test(text)) {
            targetIndices = [0, 1, 2];
        } else {
            Object.keys(ordinals).forEach(ord => {
                if (text.includes(ord)) targetIndices.push(ordinals[ord]);
            });
        }
        
        // 2. Evaluate Logic (Mutually Exclusive)

        // A. Match Logic
        if (text.includes("match")) {
            if (targetIndices.length < 2) return false;
            if (!targetIndices.every(hasDie)) return false;
            const firstVal = getVal(targetIndices[0]);
            return targetIndices.every(idx => getVal(idx) === firstVal);
        }

        // B. Roll Specific Value Logic
        const rollMatch = text.match(/roll(?:s)? a\s*(\d+)/);
        if (rollMatch) {
            const targetVal = parseInt(rollMatch[1]);
            
            if (targetIndices.length > 0) {
                // "If the first die rolls a X" or "If all three dice roll a X"
                if (!targetIndices.every(hasDie)) return false;
                return targetIndices.every(idx => getVal(idx) === targetVal);
            } else {
                // "If a die rolls a X" (no indices specified)
                return dice.some(d => parseInt(d.id) === targetVal);
            }
        }

        // C. Add Up To Logic (Each die >= X)
        if (text.includes("add up to")) {
          // Implicit "all" if not specified, though usually "all three" is caught above
          if (targetIndices.length === 0) targetIndices = [0, 1, 2]; 

          const sumMatch = text.match(/add up to\s*(\d+)/);
          const targetVal = sumMatch ? parseInt(sumMatch[1]) : 0;
          
          if (!targetIndices.every(hasDie)) return false;
          return targetIndices.every(idx => getVal(idx) >= targetVal);
        }

        // D. Consecutive Logic
        if (text.includes("consecutive")) {
          if (targetIndices.length === 0) targetIndices = [0, 1, 2];
          
          if (targetIndices.length < 2) return false;
          if (!targetIndices.every(hasDie)) return false;

          const vals = targetIndices.map(idx => getVal(idx)).sort((a, b) => a - b);
          for (let i = 0; i < vals.length - 1; i++) {
            if (vals[i+1] !== vals[i] + 1) return false;
          }
          return true;
        }

        // E. Even / Odd Logic
        if (text.includes("even number") || text.includes("odd number")) {
          const isEven = text.includes("even number");
          
          if (targetIndices.length > 0) {
              if (!targetIndices.every(hasDie)) return false;
              return targetIndices.every(idx => {
                  const val = getVal(idx);
                  return isEven ? (val % 2 === 0) : (val % 2 !== 0);
              });
          } else {
              // "If a die rolls an odd number"
              return dice.some(d => {
                  const val = parseInt(d.id);
                  return isEven ? (val % 2 === 0) : (val % 2 !== 0);
              });
          }
        }
        return true;
      };

      let totalBonus = 0;
      let multiplierSum = 0; 

      finalSites.forEach(site => {
        const parts = site.id.split('_');
        if (parts.length >= 3) {
          const rank = parts.pop();
          const type = parts.join('_');
          const effect = SITE_VALUES[type]?.[rank];
          if (effect) {
            totalBonus += effect.total;
            multiplierSum += effect.multi;
          }
        }
      });

      const evaluatedEffects = ocrResult.effects.map(eff => {
        const isActive = checkCondition(eff.condition, finalDice);
        if (isActive) {
          totalBonus += eff.diceTotal;
          multiplierSum += eff.multiplier;
        }
        return { ...eff, isActive };
      });

      const baseSum = finalDice.reduce((acc, d) => acc + parseInt(d.id || 0), 0);
      const finalMultiplier = multiplierSum > 0 ? multiplierSum : 1.0;
      const finalScore = Math.floor((baseSum + totalBonus) * finalMultiplier);

      setAnalysisResult({
        attributesText: ocrResult.rawText,
        parsedEffects: evaluatedEffects,
        diceDetails: finalDice.map(d => ({...d, accuracy: (d.score * 100).toFixed(1)})),
        siteDetails: finalSites.map(s => ({
            ...s, 
            accuracy: (s.score * 100).toFixed(1),
            r: s.r, g: s.g, b: s.b
        })),
        calculation: {
          baseSum,
          totalBonus,
          finalMultiplier: parseFloat(finalMultiplier.toFixed(2)),
          finalScore
        }
      });
  };

  const runOCR = async (cv, mainCanvas, region) => {
    let src = null;
    let roi = null;
    let enlarged = null;

    try {
        src = cv.imread(mainCanvas);
        let rect = new cv.Rect(region.x, region.y, region.w, region.h);
        roi = src.roi(rect);

        enlarged = new cv.Mat();
        let scale = 4.0; 
        let dsize = new cv.Size(region.w * scale, region.h * scale);
        cv.resize(roi, enlarged, dsize, 0, 0, cv.INTER_CUBIC);
        cv.cvtColor(enlarged, enlarged, cv.COLOR_RGBA2GRAY, 0);

        let ksize = new cv.Size(3, 3);
        cv.GaussianBlur(enlarged, enlarged, ksize, 0, 0, cv.BORDER_DEFAULT);

        cv.threshold(enlarged, enlarged, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
        cv.bitwise_not(enlarged, enlarged);
       
        const tempCanvas = document.createElement('canvas');
        cv.imshow(tempCanvas, enlarged);

        let text = "";
        if (workerRef.current) {
            const res = await workerRef.current.recognize(tempCanvas);
            text = res.data.text;
        } else {
            const { data } = await Tesseract.recognize(tempCanvas, 'eng');
            text = data.text;
        }

        const normalizedText = text.replace(/\n/g, " ");
        const parsedEffects = [];
        const sentences = normalizedText.split(/(?=If|Prevents)/i);

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

        return { rawText: text, effects: parsedEffects };
    } catch(e) {
        console.error("OCR Error:", e);
        return { rawText: "", effects: [] };
    } finally {
        if(src) src.delete();
        if(roi) roi.delete();
        if(enlarged) enlarged.delete();
    }
  };

  const renderDieFace = (id) => {
    const val = parseInt(id);
    if (isNaN(val) || val < 1 || val > 6) {
        return (
            <div className="die-face" data-value="?">
                <span style={{fontSize: '24px', fontWeight: 'bold', color: '#333'}}>{id}</span>
            </div>
        );
    }
    const pips = Array.from({ length: val }, (_, i) => <div key={i} className="pip" />);
    return (
        <div className="die-face" data-value={val}>
            {pips}
        </div>
    );
  };

  return (
    <div className="app-container">
      <header className="header">
        <h2 className="title">Mystic Frontier Calculator (Beta)</h2>
        <div className="header-actions">
          <label className="debug-toggle">
            <input 
              type="checkbox" 
              checked={showDebug} 
              onChange={(e) => setShowDebug(e.target.checked)}
            />
            Show Debug
          </label>
          <a href="https://www.buymeacoffee.com/Syou" target="_blank" rel="noreferrer" style={{ display: 'flex' }}>
            <img 
              src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" 
              alt="Buy Me A Coffee" 
              style={{ height: '42px', width: 'auto', borderRadius: '6px' }} 
            />
          </a>
          <button 
            className="btn-capture" 
            onClick={startScreenCapture} 
            disabled={!isReady}
            style={{ height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {isReady ? "Select Screen" : "Loading OpenCV..."}
          </button>
        </div>
      </header>

      <div className="content-grid">
        <div className="video-section">
          <div style={{ position: 'relative', width: '100%' }}>
            <canvas ref={canvasRef} width="1280" height="720" className="canvas-display" />
            <video ref={videoRef} style={{ display: 'none' }} muted />
          </div>
        </div>

        <div className="results-panel">
          <h3 style={{marginTop: 0}}>Analysis Results</h3>
          
          {analysisResult.calculation && (
            <div className="score-card">
              <h2 className="final-score">{analysisResult.calculation.finalScore}</h2>
              <div className="score-breakdown">
                <div>
                  <div className="breakdown-label">Total</div>
                  <div className="breakdown-value val-green">{analysisResult.calculation.totalBonus}</div>
                </div>
                <div className="val-op">+</div>
                <div>
                  <div className="breakdown-label">Dice</div>
                  <div className="breakdown-value">{analysisResult.calculation.baseSum}</div>
                </div>
                <div className="val-op">x</div>
                <div>
                  <div className="breakdown-label">Multiplier</div>
                  <div className="breakdown-value val-blue">{analysisResult.calculation.finalMultiplier}</div>
                </div>
              </div>
            </div>
          )}

          <div>
            <h4 className="section-title">Dice</h4>
            <div className="dice-container-row">
              {analysisResult.diceDetails.length > 0 ? analysisResult.diceDetails.map((d, i) => (
                <div key={i} className="die-wrapper">
                  <div className="die-info">D{i+1}</div>
                    {renderDieFace(d.id)}
                </div>
              )) : <p style={{ fontSize: '14px', color: '#666' }}>No dice detected</p>}
            </div>
          </div>
          
          <div>
            <h4 className="section-title">Site Details</h4>
            <div className="list-group">
              {analysisResult.siteDetails.length > 0 ? analysisResult.siteDetails.map((s, i) => {
                const imageName = SITE_IMAGES[s.id] || '';
                const displayName = imageName
                  ? imageName.replace('.png', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                  : s.id;
                
                let effectDesc = '';
                const parts = s.id.split('_');
                if (parts.length >= 3) {
                    const rank = parts.pop();
                    const type = parts.join('_');
                    const effect = SITE_VALUES[type]?.[rank];
                    if (effect) {
                        if (effect.total !== 0) effectDesc += `${effect.total > 0 ? '+' : ''}${effect.total} to Dice Total`;
                        if (effect.multi !== 0) {
                            if (effectDesc) effectDesc += ', ';
                            effectDesc += `${effect.multi > 0 ? '+' : ''}${effect.multi} to Final Multiplier`;
                        }
                    }
                }

                return (
                <div key={i} className="list-item item-site">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {SITE_IMAGES[s.id] && (
                      <img 
                        src={`${process.env.PUBLIC_URL}/dice/dice/${SITE_IMAGES[s.id]}`} 
                        alt={s.id} 
                        style={{ 
                          width: '32px', 
                          height: '32px', 
                          borderRadius: '4px',
                          border: '1px solid #444',
                          backgroundColor: '#333'
                        }} 
                      />
                    )}
                    <div>
                      <strong>{displayName}</strong>
                      <div style={{ fontSize: '10px', color: '#888' }}>
                        {effectDesc || `RGB: (${s.r}, ${s.g}, ${s.b})`}
                      </div>
                    </div>
                  </div>
                </div>
              );}) : <p style={{ fontSize: '14px', color: '#666' }}>No site details detected</p>}
            </div>

            <details className="details-raw" style={{marginTop: '8px'}}>
                <summary style={{cursor: 'pointer', fontSize: '12px', color: '#888'}}>Detection Details</summary>
                <div className="raw-text" style={{whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: '1.4'}}>
                    {analysisResult.siteDetails.length > 0 ? analysisResult.siteDetails.map(s => 
                        `ID: ${s.id}\n - Acc: ${s.accuracy}%\n - Pos: (${s.x}, ${s.y})\n - RGB: (${s.r}, ${s.g}, ${s.b})`
                    ).join('\n\n') : "No data"}
                </div>
            </details>
          </div>

          <div>
            <h4 className="section-title">Attributes</h4>
            <div className="list-group">
              {analysisResult.parsedEffects.length > 0 ? (
                  analysisResult.parsedEffects.map((eff, i) => (
                      <div key={i} className={`list-item item-attr ${eff.isActive ? 'attr-active' : ''}`}>
                        <div>
                          <div className="attr-condition">
                            {eff.condition ? eff.condition : '[Passive] Always Active'}
                          </div>
                          <div className="attr-effect">
                            {[eff.diceTotal !== 0 && `${eff.diceTotal > 0 ? '+' : ''}${eff.diceTotal} to Dice Total`,
                              eff.multiplier !== 0 && `${eff.multiplier > 0 ? '+' : ''}${eff.multiplier} to Final Multiplier`
                            ].filter(Boolean).join(', ')}
                          </div>
                        </div>
                      </div>
                  ))
              ) : (
                  <p style={{ fontSize: '14px', color: '#666' }}>No attributes detected</p>
              )}
            </div>
          </div>

          <details className="details-raw">
            <summary style={{cursor: 'pointer', fontSize: '12px', color: '#888'}}>Raw Text</summary>
            <div className="raw-text">
                {analysisResult.attributesText || "No text detected"}
            </div>
          </details>

        </div>
      </div>
    </div>
  );
};

export default App;