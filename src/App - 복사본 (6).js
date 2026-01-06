import React, { useEffect, useRef, useState } from 'react';
import Tesseract from 'tesseract.js';
import './App.css'; 

const App = () => {
  const [isReady, setIsReady] = useState(false);
  const [analysisResult, setAnalysisResult] = useState({
    attributesText: '',
    parsedEffects: [], 
    diceDetails: [],
    siteDetails: []
  });

  // 기준 해상도: 1366 x 768 (개발 환경 기준)
  const ROI_PCT = {
    DICE: { x: 380/1366, y: 300/768, w: 600/1366, h: 200/768 },
    ATTR: { x: 330/1366, y: 520/768, w: 700/1366, h: 100/768 },
    SITE: { x: 566/1366, y: 595/768, w: 280/1366, h: 65/768 }
  };

  const patterns = {
    diceTotal: /Dice\s*Total\s*[:;.]?\s*([+-]?\d+)/i,
    multiplier: /Final\s*Multiplier\s*[:;.]?\s*\+?([\d.]+)/i
  };
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const templatesRef = useRef([]);
  const lastSuccessfulScale = useRef(null);

  useEffect(() => {
    const checkCV = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        clearInterval(checkCV);
        loadTemplates();
        setIsReady(true);
      }
    }, 100);
    return () => clearInterval(checkCV);
  }, []);

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

  const getRankFromROI = (cv, srcMat, rect) => {
    const scale = 0.5; 
    const newW = Math.floor(rect.w * scale);
    const newH = Math.floor(rect.h * scale);
    const newX = Math.floor(rect.x + (rect.w - newW) / 2);
    const newY = Math.floor(rect.y + (rect.h - newH) / 2);

    const finalX = Math.max(0, newX);
    const finalY = Math.max(0, newY);
    const finalW = Math.min(newW, srcMat.cols - finalX);
    const finalH = Math.min(newH, srcMat.rows - finalY);

    const roi = srcMat.roi(new cv.Rect(finalX, finalY, finalW, finalH));
    const srcRGB = new cv.Mat();
    cv.cvtColor(roi, srcRGB, cv.COLOR_RGBA2RGB);
    
    const mean = cv.mean(srcRGB);
    const r = mean[0];
    const g = mean[1];
    const b = mean[2];

    roi.delete(); srcRGB.delete();

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
  };

  const loadTemplates = React.useCallback(async () => {
    const cv = window.cv;
    const diceFiles = [
      { id: '1', path: 'dice_1.png' }, { id: '2', path: 'dice_2.png' },
      { id: '3', path: 'dice_3.png' }, { id: '4', path: 'dice_4.png' },   
      { id: '5', path: 'dice_5.png' }, { id: '6', path: 'dice_6.png' },
      // Primary templates (from public/dice/)
      ...Object.entries(SITE_IMAGES).map(([id, path]) => ({ id, path })),
      // Secondary templates (from public/dice/dice/) - smaller icons/variants
      ...Object.entries(SITE_IMAGES).map(([id, path]) => ({ id, path: `dice/${path}` }))
    ];

    const loaded = [];
    for (const file of diceFiles) {
      await new Promise((resolve) => {
        const img = new Image();
        img.src = `${process.env.PUBLIC_URL}/dice/${file.path}`;
        img.crossOrigin = "Anonymous";
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const mat = cv.imread(canvas);
          const grayMat = new cv.Mat();
          cv.cvtColor(mat, grayMat, cv.COLOR_RGBA2GRAY, 0);
          loaded.push({ id: file.id, mat, grayMat });
          resolve();
        };
        img.onerror = () => {
            resolve();
        };
      });
    }
    templatesRef.current = loaded;
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
      setInterval(analyzeFrame, 1000);
    } catch (err) {
      console.error("Error accessing screen:", err);
    }
  };

  const analyzeFrame = async () => {
    if (!videoRef.current || !isReady || templatesRef.current.length === 0) return;
    const cv = window.cv;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const cw = canvas.width;
    const ch = canvas.height;

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

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = cw; cleanCanvas.height = ch;
    const cleanCtx = cleanCanvas.getContext('2d');
    cleanCtx.drawImage(canvas, 0, 0);

    ctx.save();
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(attrRect.x, attrRect.y, attrRect.w, attrRect.h);
    ctx.fillStyle = '#ffff00';
    ctx.font = 'bold 12px Arial';
    ctx.fillText("OCR AREA", attrRect.x, attrRect.y - 5);
    
    ctx.strokeStyle = '#00bfff';
    ctx.strokeRect(siteRect.x, siteRect.y, siteRect.w, siteRect.h);
    ctx.fillText("SITE AREA", siteRect.x, siteRect.y - 5);

    ctx.strokeStyle = '#00ff00';
    ctx.strokeRect(diceRect.x, diceRect.y, diceRect.w, diceRect.h);
    ctx.fillText("DICE AREA", diceRect.x, diceRect.y - 5);
    ctx.restore();

    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    const siteROI = new cv.Rect(siteRect.x, siteRect.y, siteRect.w, siteRect.h);
    const diceROI = new cv.Rect(diceRect.x, diceRect.y, diceRect.w, diceRect.h);
    
    if (siteRect.x + siteRect.w > gray.cols) siteRect.w = gray.cols - siteRect.x;
    if (siteRect.y + siteRect.h > gray.rows) siteRect.h = gray.rows - siteRect.y;
    if (diceRect.x + diceRect.w > gray.cols) diceRect.w = gray.cols - diceRect.x;
    if (diceRect.y + diceRect.h > gray.rows) diceRect.h = gray.rows - diceRect.y;

    let graySiteROI = gray.roi(siteROI);
    let grayDiceROI = gray.roi(diceROI); 

    let enlargedSiteROI = new cv.Mat();
    let enlargedSize = new cv.Size(siteROI.width * 2, siteROI.height * 2);
    cv.resize(graySiteROI, enlargedSiteROI, enlargedSize, 0, 0, cv.INTER_CUBIC);

    const scales = lastSuccessfulScale.current ? [lastSuccessfulScale.current] : [0.8, 0.9, 1.0, 1.1, 1.2];
    let diceCandidates = [];
    let siteCandidates = [];

    templatesRef.current.forEach((tmpl) => {
      const isSiteCategory = tmpl.id.startsWith('S_');
      const searchImg = isSiteCategory ? enlargedSiteROI : grayDiceROI;

      scales.forEach((s) => {
        let currentScale = isSiteCategory ? (s * 2.0) : s;
        let resizedTmpl = new cv.Mat();
        
        const tW = Math.round(tmpl.grayMat.cols * currentScale);
        const tH = Math.round(tmpl.grayMat.rows * currentScale);
        if (tW > searchImg.cols || tH > searchImg.rows) {
             resizedTmpl.delete(); return;
        }

        cv.resize(tmpl.grayMat, resizedTmpl, new cv.Size(tW, tH), 0, 0, cv.INTER_CUBIC);
        
        let dst = new cv.Mat();
        cv.matchTemplate(searchImg, resizedTmpl, dst, cv.TM_CCOEFF_NORMED);

        let data = dst.data32F;
        const threshold = isSiteCategory ? 0.5 : 0.7; 

        for (let row = 0; row < dst.rows; row += 2) {
          for (let col = 0; col < dst.cols; col += 2) {
            const score = data[row * dst.cols + col];
            if (score > threshold) {
              if (isSiteCategory) {
                siteCandidates.push({
                  id: tmpl.id,
                  score: score,
                  x: Math.round(col * 0.5) + siteROI.x,
                  y: Math.round(row * 0.5) + siteROI.y,
                  w: Math.round(resizedTmpl.cols * 0.5),
                  h: Math.round(resizedTmpl.rows * 0.5),
                  usedScale: s
                });
              } else {
                const absX = col + diceROI.x;
                const absY = row + diceROI.y;
                
                diceCandidates.push({
                    id: tmpl.id,
                    score: score,
                    x: absX, y: absY, w: resizedTmpl.cols, h: resizedTmpl.rows,
                    usedScale: s
                });
              }
            }
          }
        }
        resizedTmpl.delete(); dst.delete();
      });
    });

    const applyNMS = (candidates, iouThreshold = 0.2) => {
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

    const finalDice = applyNMS(diceCandidates, 0.2).sort((a, b) => a.x - b.x);
    let detectedSites = applyNMS(siteCandidates, 0.2); 

    const finalSites = detectedSites.map(site => {
      const { rank, r, g, b } = getRankFromROI(cv, src, site);
      const parts = site.id.split('_');
      let newId = site.id;
      if (parts.length >= 3) {
          parts[parts.length - 1] = rank;
          newId = parts.join('_');
      }
      return { ...site, id: newId, r, g, b };
    }).sort((a, b) => a.x - b.x);    

    if (finalDice.length >= 2) lastSuccessfulScale.current = finalDice[0].usedScale;

    finalDice.forEach(d => {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(`${d.id}`, d.x, d.y - 5);
    });

    finalSites.forEach(s => {
      ctx.strokeStyle = '#00bfff';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#00bfff';
      ctx.font = 'bold 12px Arial';
    });

    let ocrResult = { rawText: "", effects: [] };
    if (attrRect.w > 20 && attrRect.h > 10) {
      ocrResult = await runOCR(cleanCanvas, attrRect);
    }

    const checkCondition = (condition, dice) => {
      const text = condition.toLowerCase().trim();
      if (!text) return true;

      const getVal = (idx) => parseInt(dice[idx]?.id || 0);
      const ordinals = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };

      if (text.includes("add up to")) {
        const targetIndices = [];
        Object.keys(ordinals).forEach(ord => {
          if (text.includes(ord)) targetIndices.push(ordinals[ord]);
        });
        
        if (targetIndices.length === 0) {
            dice.forEach((_, i) => targetIndices.push(i));
        }

        const targetMatch = text.match(/(\d+)/);
        const target = targetMatch ? parseInt(targetMatch[1]) : 0;
        
        if (targetIndices.length > 0 && target > 0) {
            return targetIndices.every(idx => {
                const d = dice[idx];
                return d && parseInt(d.id) >= target;
            });
        }
      }

      if (text.includes("consecutive numbers")) {
        if (dice.length < 2) return false;
        const vals = dice.map(d => parseInt(d.id)).sort((a, b) => a - b);
        for (let i = 0; i < vals.length - 1; i++) {
          if (vals[i+1] !== vals[i] + 1) return false;
        }
        return true;
      }

      if (text.includes("even number") || text.includes("odd number")) {
        const isEven = text.includes("even number");
        for (const [ord, idx] of Object.entries(ordinals)) {
          if (text.includes(ord)) {
             if (!dice[idx]) return false;
             const val = getVal(idx);
             return isEven ? (val % 2 === 0) : (val % 2 !== 0);
          }
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

    src.delete(); gray.delete(); 
    graySiteROI.delete(); grayDiceROI.delete(); enlargedSiteROI.delete();
  };

  const runOCR = async (mainCanvas, region) => {
    const cv = window.cv;
    let src = cv.imread(mainCanvas);
    let rect = new cv.Rect(region.x, region.y, region.w, region.h);
    let roi = src.roi(rect);

    let enlarged = new cv.Mat();
    let scale = 2.0; 
    let dsize = new cv.Size(region.w * scale, region.h * scale);
    cv.resize(roi, enlarged, dsize, 0, 0, cv.INTER_CUBIC);
    cv.cvtColor(enlarged, enlarged, cv.COLOR_RGBA2GRAY, 0);

    cv.threshold(enlarged, enlarged, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.bitwise_not(enlarged, enlarged);
   
    const tempCanvas = document.createElement('canvas');
    cv.imshow(tempCanvas, enlarged);

    const { data: { text } } = await Tesseract.recognize(tempCanvas, 'eng', {
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:,.+-!% '
    });
    
    src.delete(); roi.delete(); enlarged.delete();

    const normalizedText = text.replace(/\n/g, " ");
    const parsedEffects = [];
    const sentences = normalizedText.split(/(?=If|Prevents)/i);

    sentences.forEach(sentence => {
      const trimmed = sentence.trim();
      if (trimmed.length < 5) return;

      const totalMatch = trimmed.match(patterns.diceTotal);
      const multiMatch = trimmed.match(patterns.multiplier);
      const isPrevents = /prevents/i.test(trimmed);

      if (totalMatch || multiMatch || isPrevents) {
        let effectIndex = trimmed.length;
        if (totalMatch && totalMatch.index < effectIndex) effectIndex = totalMatch.index;
        if (multiMatch && multiMatch.index < effectIndex) effectIndex = multiMatch.index;

        let conditionText = trimmed.substring(0, effectIndex).replace(/[:;.,-]$/, "").trim();
        
        if (isPrevents && !/if/i.test(conditionText)) {
        }

        parsedEffects.push({
          text: trimmed, 
          condition: conditionText,
          diceTotal: totalMatch ? parseInt(totalMatch[1]) : 0,
          multiplier: multiMatch ? parseFloat(multiMatch[1]) : 0
        });
      }
    });

    return { rawText: text, effects: parsedEffects };
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
                      <div style={{ fontSize: '10px', color: '#888' }}>{effectDesc || `RGB: (${s.r}, ${s.g}, ${s.b})`}</div>
                    </div>
                  </div>
                </div>
              );}) : <p style={{ fontSize: '14px', color: '#666' }}>No site details detected</p>}
            </div>
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
