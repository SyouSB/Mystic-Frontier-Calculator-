import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Tesseract from 'tesseract.js';
import './App.css'; 

/*
// 기준 해상도: 1366 x 768 
const ROI_PCT = {
  DICE: { x: 380/1366, y: 300/768, w: 600/1366, h: 200/768 },
  ATTR: { x: 300/1366, y: 480/768, w: 730/1366, h: 180/768 },
  SITE: { x: 566/1366, y: 595/768, w: 280/1366, h: 65/768 }
};
*/

// 기준 해상도: 1366 x 768 
const ROI_PCT = {
  DICE: { x: 620/1366, y: 320/768, w: 600/1366, h: 160/768 },
  ATTR: { x: 540/1366, y: 480/768, w: 730/1366, h: 180/768 },
  SITE: { x: 800/1366, y: 595/768, w: 280/1366, h: 65/768 }
};

const SITE_SCALE_FACTOR = 2.5;

const PATTERNS = {
  diceTotal: /Dice\s*Total\s*[^0-9+-]*([+-]?\s*\d+)/i,
  multiplier: /Final\s*[^0-9+-]*\+?\s*([\d\s.]+)/i
};

// 색상 기반 등급 판정
const RANK_COLORS = {
  'Common': { r: 120, g: 120, b: 110 },   // Gray
  'Rare': { r: 80, g: 150, b: 155 },     // Blue
  'Epic': { r: 145, g: 100, b: 155 },    // Purple
  'Unique': { r: 215, g: 140, b: 60 },   // Orange
  'Legendry': { r: 80, g: 190, b: 80 }   // Green
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
  const [diceMaxVal, setDiceMaxVal] = useState([6, 6, 6]);
  const [estimateDice, setEstimateDice] = useState(null);
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
  const lastDetectedDiceRef = useRef([]);
  const analysisTimerRef = useRef(null);
  const renderRequestIdRef = useRef(null);
  const offscreenCanvasRef = useRef(null);

  const renderLoop = useCallback(() => {
    if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
      renderRequestIdRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      if (showDebug) {
        drawROIs(ctx, canvas.width, canvas.height);
      }
    }
    renderRequestIdRef.current = requestAnimationFrame(renderLoop);
  }, [showDebug]);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject && !videoRef.current.paused) {
      if (renderRequestIdRef.current) cancelAnimationFrame(renderRequestIdRef.current);
      renderRequestIdRef.current = requestAnimationFrame(renderLoop);
    }
  }, [renderLoop]);

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
      if (renderRequestIdRef.current) {
        cancelAnimationFrame(renderRequestIdRef.current);
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
      
      if (renderRequestIdRef.current) cancelAnimationFrame(renderRequestIdRef.current);
      renderRequestIdRef.current = requestAnimationFrame(renderLoop);

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
        // 중앙 부분 50%만 샘플링하여 속도 최적화
        const scale = 0.5; 
        const newW = Math.floor(rect.w * scale);
        const newH = Math.floor(rect.h * scale);
        const newX = Math.floor(rect.x + (rect.w - newW) / 2);
        const newY = Math.floor(rect.y + (rect.h - newH) / 2);

        // 이미지 범위 체크
        const finalX = Math.max(0, newX);
        const finalY = Math.max(0, newY);
        const finalW = Math.min(newW, srcMat.cols - finalX);
        const finalH = Math.min(newH, srcMat.rows - finalY);

        if (finalW <= 0 || finalH <= 0) return { rank: 'Common', r: 0, g: 0, b: 0 };

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
            // 유클리드 거리로 색상 차이 계산
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
    } catch(e) {
        return { rank: 'Common', r: 0, g: 0, b: 0 };
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
        const cw = canvas.width;
        const ch = canvas.height;

        // 분석을 위한 별도의 캔버스 캡처 (UI 드로잉과 분리)
        if (!offscreenCanvasRef.current) {
            offscreenCanvasRef.current = document.createElement('canvas');
        }
        const offscreen = offscreenCanvasRef.current;
        if (offscreen.width !== cw || offscreen.height !== ch) {
            offscreen.width = cw;
            offscreen.height = ch;
        }
        
        const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
        offCtx.drawImage(videoRef.current, 0, 0, cw, ch);

        const src = track(cv.imread(offscreen));

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
        const grayDiceROI = track(gray.roi(diceROI)); 

        const diceScales = lastSuccessfulScale.current ? [lastSuccessfulScale.current] : [0.8, 0.9, 1.0, 1.1, 1.2];
        const siteScales = [0.9, 1.0, 1.1]; 

        let diceCandidates = [];
        const diceTemplates = templatesRef.current.filter(t => !t.id.startsWith('S_'));
        const siteTemplates = templatesRef.current.filter(t => t.id.startsWith('S_'));

        // 1단계: 주사위만 먼저 탐지
        for (const tmpl of diceTemplates) {
            for (const s of diceScales) {
                const resizedTmpl = tmpl.precomputed?.[s];
                if (!resizedTmpl || resizedTmpl.cols > grayDiceROI.cols || resizedTmpl.rows > grayDiceROI.rows) continue;

                let dst = track(new cv.Mat());
                cv.matchTemplate(grayDiceROI, resizedTmpl, dst, cv.TM_CCOEFF_NORMED);
                let data = dst.data32F;
                
                for (let row = 0; row < dst.rows; row += 2) {
                    for (let col = 0; col < dst.cols; col += 2) {
                        if (data[row * dst.cols + col] > 0.75) {
                            diceCandidates.push({
                                id: tmpl.id, score: data[row * dst.cols + col],
                                x: col + diceROI.x, y: row + diceROI.y,
                                w: resizedTmpl.cols, h: resizedTmpl.rows, usedScale: s
                            });
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
        let finalSites = [];
        let ocrResult = { rawText: "", effects: [] };

        // 2단계: 주사위가 3개일 때만 사이트 및 OCR 실행
        if (finalDice.length === 3) {
            lastSuccessfulScale.current = finalDice[0].usedScale;

            // Site 탐지
            let siteCandidates = [];
            let siteROI_RGB = track(srcRGB.roi(siteROI));
            let enlargedSiteROI = track(new cv.Mat());
            let enlargedSize = new cv.Size(
                Math.round(siteROI.width * SITE_SCALE_FACTOR), 
                Math.round(siteROI.height * SITE_SCALE_FACTOR)
            );
            cv.resize(siteROI_RGB, enlargedSiteROI, enlargedSize, 0, 0, cv.INTER_CUBIC);

            for (const tmpl of siteTemplates) {
                for (const s of siteScales) {
                    const resizedTmpl = tmpl.precomputed?.[s];
                    if (!resizedTmpl || resizedTmpl.cols > enlargedSiteROI.cols || resizedTmpl.rows > enlargedSiteROI.rows) continue;

                    let dst = track(new cv.Mat());
                    cv.matchTemplate(enlargedSiteROI, resizedTmpl, dst, cv.TM_CCOEFF_NORMED);
                    let data = dst.data32F;
                    
                    for (let row = 0; row < dst.rows; row += 2) {
                        for (let col = 0; col < dst.cols; col += 2) {
                            if (data[row * dst.cols + col] > 0.6) {
                                const downScale = 1.0 / SITE_SCALE_FACTOR;
                                siteCandidates.push({
                                    id: tmpl.id, score: data[row * dst.cols + col],
                                    x: Math.round(col * downScale) + siteROI.x,
                                    y: Math.round(row * downScale) + siteROI.y,
                                    w: Math.round(resizedTmpl.cols * downScale),
                                    h: Math.round(resizedTmpl.rows * downScale)
                                });
                            }
                        }
                    }
                }
            }

            const detectedSites = applyNMS(siteCandidates, 0.4);
            finalSites = detectedSites.map(site => {
                const { rank, r, g, b } = getRankFromROI(cv, src, site);
                const parts = site.id.split('_');
                if (parts.length >= 3) {
                    parts.pop();
                    parts.push(rank);
                    const newId = parts.join('_');
                    if (SITE_IMAGES[newId]) return { ...site, id: newId, r, g, b };
                }
                return { ...site, r, g, b };
            }).sort((a, b) => a.x - b.x);

            // OCR 실행
            let shouldRunOCR = true;
            const attrROI = track(gray.roi(new cv.Rect(attrRect.x, attrRect.y, attrRect.w, attrRect.h)));

            if (lastAttrMatRef.current && 
                lastAttrMatRef.current.rows === attrROI.rows && 
                lastAttrMatRef.current.cols === attrROI.cols) {
                const diff = new cv.Mat();
                cv.absdiff(attrROI, lastAttrMatRef.current, diff);
                if (cv.countNonZero(diff) < 50) shouldRunOCR = false;
                diff.delete();
            }

            if (shouldRunOCR) {
                ocrResult = await runOCR(cv, src, attrRect);
                lastOcrResultRef.current = ocrResult;
                if (lastAttrMatRef.current) lastAttrMatRef.current.delete();
                lastAttrMatRef.current = attrROI.clone();
            } else {
                ocrResult = lastOcrResultRef.current || { rawText: "", effects: [] };
            }
        } else {
            // 주사위가 3개가 아니면 이전 OCR 데이터 초기화 (선택 사항)
            // lastOcrResultRef.current = null;
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

  const checkCondition = useCallback((condition, dice) => {
    const text = condition.toLowerCase().trim();
    if (!text) return true;
    if (text.startsWith("prevents")) return true;
    
    const getVal = (idx) => {
        const d = dice[idx];
        if (!d) return 0;
        return typeof d === 'object' ? parseInt(d.id || 0) : parseInt(d);
    };
    const hasDie = (idx) => dice[idx] !== undefined;

    const ordinals = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
    let targetIndices = [];
    if (/all three|all 3|the three/i.test(text)) {
        targetIndices = [0, 1, 2];
    } else {
        Object.keys(ordinals).forEach(ord => {
            if (text.includes(ord)) targetIndices.push(ordinals[ord]);
        });
    }
    
    if (text.includes("match")) {
        if (targetIndices.length < 2) return false;
        if (!targetIndices.every(hasDie)) return false;
        const firstVal = getVal(targetIndices[0]);
        return targetIndices.every(idx => getVal(idx) === firstVal);
    }

    const rollMatch = text.match(/roll(?:s)? a\s*(\d+)/);
    if (rollMatch) {
        const targetVal = parseInt(rollMatch[1]);
        if (targetIndices.length > 0) {
            if (!targetIndices.every(hasDie)) return false;
            return targetIndices.every(idx => getVal(idx) === targetVal);
        } else {
            return dice.some((_, i) => getVal(i) === targetVal);
        }
    }

    if (text.includes("add up to") || text.includes("are each")) {
      if (targetIndices.length === 0) targetIndices = [0, 1, 2]; 
      const sumMatch = text.match(/(?:up to|each)\s*(\d+)/);
      const targetVal = sumMatch ? parseInt(sumMatch[1]) : 0;
      if (!targetIndices.every(hasDie)) return false;
      return targetIndices.every(idx => getVal(idx) >= targetVal);
    }

    if (text.includes("consecutive")) {
      if (targetIndices.length === 0) targetIndices = [0, 1, 2];
      if (targetIndices.length < 2 || !targetIndices.every(hasDie)) return false;
      const vals = targetIndices.map(idx => getVal(idx)).sort((a, b) => a - b);
      for (let i = 0; i < vals.length - 1; i++) if (vals[i+1] !== vals[i] + 1) return false;
      return true;
    }

    if (text.includes("even number") || text.includes("odd number")) {
      const isEven = text.includes("even number");
      if (targetIndices.length > 0) {
          if (!targetIndices.every(hasDie)) return false;
          return targetIndices.every(idx => {
              const val = getVal(idx);
              return isEven ? (val % 2 === 0) : (val % 2 !== 0);
          });
      } else {
          return dice.some((_, i) => {
              const val = getVal(i);
              return isEven ? (val % 2 === 0) : (val % 2 !== 0);
          });
      }
    }

    if (text.includes("higher than the second")) {
        if (!hasDie(0) || !hasDie(1)) return false;
        return getVal(0) > getVal(1);
    }
    if (text.includes("lower than the second")) {
        if (!hasDie(0) || !hasDie(1)) return false;
        return getVal(0) < getVal(1);
    }

    return true;
  }, []);

  const results = useMemo(() => {
    const { diceDetails, siteDetails, parsedEffects } = analysisResult;
    
    const calculateScore = (dice) => {
        let totalBonus = 0;
        let multiSum = 0;

        siteDetails.forEach(site => {
            const parts = site.id.split('_');
            if (parts.length >= 3) {
                const rank = parts.pop();
                const type = parts.join('_');
                const effect = SITE_VALUES[type]?.[rank];
                if (effect) {
                    totalBonus += effect.total;
                    multiSum += effect.multi;
                }
            }
        });

        const evaluated = parsedEffects.map(eff => {
            const isActive = checkCondition(eff.condition, dice);
            if (isActive) {
                totalBonus += eff.diceTotal;
                multiSum += eff.multiplier;
            }
            return { ...eff, isActive };
        });

        const baseSum = dice.reduce((acc, d) => {
            const val = typeof d === 'object' ? parseInt(d.id || 0) : parseInt(d);
            return acc + (isNaN(val) ? 0 : val);
        }, 0);

        const multiplier = multiSum > 0 ? multiSum : 1.0;
        return {
            baseSum,
            totalBonus,
            multiplier: parseFloat(multiplier.toFixed(2)),
            finalScore: Math.floor((baseSum + totalBonus) * multiplier),
            evaluated
        };
    };

    let current = null;
    if (diceDetails.length === 3) {
        current = calculateScore(diceDetails);
    }

    // Estimate 계산: estimateDice가 null이면 결과도 null
    let estimate = null;
    if (estimateDice) {
        const safeEstDice = estimateDice.map(v => v === '' ? 1 : v);
        estimate = calculateScore(safeEstDice);
    }

    let scoreRange = null;
    if (diceDetails.length === 3) {
        let minScore = Infinity, maxScore = -Infinity;
        let minCombo = [], maxCombo = [];
        
        // Max 설정 빈 칸은 4로 취급하여 시뮬레이션
        const safeMax = diceMaxVal.map(v => v === '' ? 4 : v);

        for (let d1 = 1; d1 <= safeMax[0]; d1++) {
            for (let d2 = 1; d2 <= safeMax[1]; d2++) {
                for (let d3 = 1; d3 <= safeMax[2]; d3++) {
                    const sim = calculateScore([d1, d2, d3]);
                    if (sim.finalScore < minScore) { minScore = sim.finalScore; minCombo = [d1, d2, d3]; }
                    if (sim.finalScore > maxScore) { maxScore = sim.finalScore; maxCombo = [d1, d2, d3]; }
                }
            }
        }
        scoreRange = { min: minScore, max: maxScore, minCombo, maxCombo };
    }

    return { current, estimate, scoreRange };
  }, [analysisResult, diceMaxVal, estimateDice, checkCondition]);

  const processLogic = (finalDice, finalSites, ocrResult) => {
      if (finalDice.length === 3) {
          const detectedVals = finalDice.map(d => parseInt(d.id));
          
          // 실시간 탐지값이 이전에 탐지했던 값과 실제로 다를 때만 Estimate 동기화
          if (JSON.stringify(detectedVals) !== JSON.stringify(lastDetectedDiceRef.current)) {
              setEstimateDice(detectedVals);
              lastDetectedDiceRef.current = detectedVals;
          }
      }

      setAnalysisResult({
        attributesText: ocrResult.rawText,
        parsedEffects: ocrResult.effects,
        diceDetails: finalDice,
        siteDetails: finalSites
      });
  };

  const runOCR = async (cv, srcMat, region) => {
    let roi = null;
    let enlarged = null;

    try {
        let rect = new cv.Rect(region.x, region.y, region.w, region.h);
        roi = srcMat.roi(rect);

        enlarged = new cv.Mat();
        let scale = 4.0; 
        let dsize = new cv.Size(region.w * scale, region.h * scale);
        cv.resize(roi, enlarged, dsize, 0, 0, cv.INTER_CUBIC);
        
        // 그레이스케일 변환
        cv.cvtColor(enlarged, enlarged, cv.COLOR_RGBA2GRAY, 0);

        // 이진화 (Otsu): 밝은 글자(흰색)를 255로, 어두운 배경을 0으로 분리
        cv.threshold(enlarged, enlarged, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

        // 색상 반전: 검은 글자/흰 배경으로 변환
        cv.bitwise_not(enlarged, enlarged);

        const tempCanvas = document.createElement('canvas');
        cv.imshow(tempCanvas, enlarged);

        let text = "";
        if (workerRef.current) {
            const res = await workerRef.current.recognize(tempCanvas);
            text = res.data.text;
        } else {
            const { data } = await Tesseract.recognize(tempCanvas, 'eng');
            text = data.data.text;
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
            
            // Dice Total: 공백 제거 없이 parseInt로 앞부분 숫자만 취함 (+9 7 -> 9)
            const totalStr = totalMatch ? totalMatch[1] : "0";
            // Multiplier: 소수점 사이 공백 대응을 위해 공백 제거 유지 (1. 2 -> 1.2)
            const multiStr = multiMatch ? multiMatch[1].replace(/\s+/g, '') : "0";

            parsedEffects.push({
              text: trimmed, 
              condition: conditionText,
              diceTotal: parseInt(totalStr) || 0,
              multiplier: parseFloat(multiStr) || 0
            });
          }
        });

        return { rawText: text, effects: parsedEffects };
    } catch(e) {
        console.error("OCR Error:", e);
        return { rawText: "", effects: [] };
    } finally {
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
        <h2 className="title">Mystic Frontier Calculator</h2>
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
          
          {results.current && (
            <div className="score-card current-card">
              <div className="card-tag">Current</div>
              <h2 className="final-score">{results.current.finalScore}</h2>
              <div className="score-breakdown">
                <div>
                  <div className="breakdown-label">Total</div>
                  <div className="breakdown-value val-green">{results.current.totalBonus}</div>
                </div>
                <div className="val-op">+</div>
                <div>
                  <div className="breakdown-label">Dice</div>
                  <div className="breakdown-value">{results.current.baseSum}</div>
                </div>
                <div className="val-op">x</div>
                <div>
                  <div className="breakdown-label">Multiplier</div>
                  <div className="breakdown-value val-blue">{results.current.multiplier}</div>
                </div>
              </div>
            </div>
          )}

          {results.estimate ? (
            <div className="score-card estimate-card">
              <div className="card-tag">Estimate</div>
              <div className="estimate-controls">
                {estimateDice.map((val, i) => (
                  <div key={i} className="est-input-group">
                    <div className="est-label">D{i+1}</div>
                    <input 
                      type="number" min="1" max="6" value={val} 
                      onChange={(e) => {
                        const raw = e.target.value;
                        const newVals = [...estimateDice];
                        if (raw === '') {
                          newVals[i] = '';
                        } else {
                          const v = parseInt(raw);
                          newVals[i] = isNaN(v) ? '' : Math.max(1, Math.min(6, v));
                        }
                        setEstimateDice(newVals);
                      }}
                      onFocus={(e) => e.target.select()}
                      className="est-input"
                    />
                  </div>
                ))}
              </div>
              <h2 className="final-score est-score">{results.estimate.finalScore}</h2>
              
              <div className="score-breakdown">
                <div>
                  <div className="breakdown-label">Total</div>
                  <div className="breakdown-value val-green">{results.estimate.totalBonus}</div>
                </div>
                <div className="val-op">+</div>
                <div>
                  <div className="breakdown-label">Dice</div>
                  <div className="breakdown-value">{results.estimate.baseSum}</div>
                </div>
                <div className="val-op">x</div>
                <div>
                  <div className="breakdown-label">Multiplier</div>
                  <div className="breakdown-value val-blue">{results.estimate.multiplier}</div>
                </div>
              </div>
              
              <div className="score-range-info">
                {results.scoreRange && (
                  <>
                    <div className="range-label">Range</div>
                    <div className="range-grid">
                      <div className="range-col min">
                        <div className="range-type-label">MIN</div>
                        <div className="range-score-val">{results.scoreRange.min}</div>
                        <div className="range-combo">[{results.scoreRange.minCombo.join(',')}]</div>
                      </div>
                      <div className="range-sep-line">~</div>
                      <div className="range-col max">
                        <div className="range-type-label">MAX</div>
                        <div className="range-score-val">{results.scoreRange.max}</div>
                        <div className="range-combo">[{results.scoreRange.maxCombo.join(',')}]</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="score-card estimate-card" style={{ padding: '40px 15px', color: '#666', fontSize: '14px' }}>
               <div className="card-tag">Estimate</div>
               Waiting for dice...
            </div>
          )}

          <div>
            <h4 className="section-title">Dice</h4>
            <div className="dice-container-row">
              {analysisResult.diceDetails.length === 3 ? analysisResult.diceDetails.map((d, i) => (
                <div key={i} className="die-wrapper">
                  <div className="die-max-input-wrapper">
                    <span className="die-label">D{i+1} Max</span>
                    <input 
                      type="number" min="4" max="6" value={diceMaxVal[i]} 
                      onChange={(e) => {
                        const raw = e.target.value;
                        const newVals = [...diceMaxVal];
                        if (raw === '') {
                          newVals[i] = '';
                        } else {
                          const v = parseInt(raw);
                          newVals[i] = isNaN(v) ? '' : Math.max(4, Math.min(6, v));
                        }
                        setDiceMaxVal(newVals);
                      }}
                      onFocus={(e) => e.target.select()}
                      className="dice-input-mini"
                    />
                  </div>
                  {renderDieFace(d.id)}
                </div>
              )) : (
                <p style={{ fontSize: '14px', color: '#666', margin: '20px 0' }}>Waiting for dice...</p>
              )}
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
                        {effectDesc || `Score: ${(s.score * 100).toFixed(1)}%`}
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
              {results.estimate ? (
                  results.estimate.evaluated.map((eff, i) => (
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
                  <p style={{ fontSize: '14px', color: '#666' }}>Waiting for dice...</p>
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