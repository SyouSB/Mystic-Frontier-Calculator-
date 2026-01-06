import React, { useEffect, useRef, useState } from 'react';
import Tesseract from 'tesseract.js';
// Fuse는 이제 텍스트 전체 교정보다는 보조적인 역할 혹은 제거 가능하지만, 일단 유지
import Fuse from 'fuse.js'; 

const App = () => {
  const [isReady, setIsReady] = useState(false);
  const [analysisResult, setAnalysisResult] = useState({
    attributesText: '',
    parsedEffects: [], // 추출된 효과 리스트 (계산용)
    diceDetails: [],
    siteDetails: []
  });

  // [변경 1 & 3] 고정 좌표 대신 해상도 비율(%) 상수 정의
  // 기준 해상도: 1366 x 768 (개발 환경 기준)
  const ROI_PCT = {
    // Dice 영역 (주사위가 굴러가는 중앙 상단 영역)
    DICE: { x: 380/1366, y: 300/768, w: 600/1366, h: 200/768 },
    // Attributes 영역 (중앙 하단 텍스트)
    ATTR: { x: 330/1366, y: 520/768, w: 700/1366, h: 100/768 },
    // Site 영역 (주사위 아래 아이콘들)
    SITE: { x: 570/1366, y: 595/768, w: 280/1366, h: 65/768 }
  };

  // 개선된 정규식 패턴
  const patterns = {
    // Dice Total: +2 또는 Dice Total:+2 모두 대응
    diceTotal: /Dice\s*Total\s*[:;.]?\s*([+-]?\d+)/i,

    // Final Multiplier: +1.2x 또는 FinalMultiplier+1.2 모두 대응
    // [\d.]+ 를 통해 1.2 같은 소수점을 안전하게 추출합니다.
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

  // 색상 거리 비교를 위한 기준 색상 정의 (RGB)
  // [수정] 실제 게임 화면의 색상(채도가 낮음)에 맞춰 기준값 조정
  const RANK_COLORS = {
    'Common': { r: 120, g: 120, b: 110 },
    'Unique': { r: 215, g: 140, b: 60 },   // 주황 (채도 하향)
    'Legendry': { r: 80, g: 190, b: 80 },  // 초록 (채도 하향)
    'Rare': { r: 80, g: 150, b: 155 },     // 파랑 (채도 하향)
    'Epic': { r: 145, g: 100, b: 155 }     // 보라 (사용자 제보 값 적용)
  };

  // ROI에서 색상 등급 추출 함수 (RGB 거리 기반)
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

    // 가장 가까운 색상 찾기 (Euclidean Distance)
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

  const loadTemplates = async () => {
    const cv = window.cv;
    // ... (기존 파일 리스트 동일) ...
    const diceFiles = [
      { id: '1', path: 'dice_1.png' }, { id: '2', path: 'dice_2.png' },
      { id: '3', path: 'dice_3.png' }, { id: '4', path: 'dice_4.png' },   
      { id: '5', path: 'dice_5.png' }, { id: '6', path: 'dice_6.png' },

      { id: 'S_+_Common', path: './dice/blessed_gray_dice.png' },    //{ id: 'S_+_Rare', path: 'blessed_gray_dice.png' },
      { id: 'S_+_Rare', path: './dice/blessed_blue_dice.png' },      //{ id: 'S_+_Rare', path: 'blessed_blue_dice.png' },
      { id: 'S_+_Epic', path: './dice/blessed_purple_dice.png' },    //{ id: 'S_+_Rare', path: 'blessed_purple_dice.png' },
      { id: 'S_+_Unique', path: './dice/blessed_orange_dice.png' },  //{ id: 'S_+_Rare', path: 'blessed_orange_dice.png' },
      { id: 'S_+_Legendry', path: './dice/blessed_green_dice.png' }, //{ id: 'S_+_Rare', path: 'blessed_green_dice.png' },

      { id: 'S_+x_Common', path: './dice/gray_holy_rollers.png' }, { id: 'S_+x_Common', path: 'gray_holy_rollers.png' },
      { id: 'S_+x_Rare', path: './dice/blue_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'blue_holy_rollers.png' },
      { id: 'S_+x_Epic', path: './dice/purple_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'purple_holy_rollers.png' },
      { id: 'S_+x_Unique', path: './dice/orange_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'orange_holy_rollers.png' },
      { id: 'S_+x_Legendry', path: './dice/green_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'green_holy_rollers.png' },

      { id: 'S_-x_Common', path: './dice/sharp_edged_gray_dice.png' }, { id: 'S_-x_Common', path: 'sharp_edged_gray_dice.png' },
      { id: 'S_-x_Rare', path: './dice/sharp_edged_blue_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_blue_dice.png' },
      { id: 'S_-x_Epic', path: './dice/sharp_edged_purple_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_purple_dice.png' },
      { id: 'S_-x_Unique', path: './dice/sharp_edged_orange_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_orange_dice.png' },
      { id: 'S_-x_Legendry', path: './dice/sharp_edged_green_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_green_dice.png' },

      { id: 'S_x_Common', path: './dice/swift_rolling_gray_dice.png' }, { id: 'S_x_Common', path: 'swift_rolling_gray_dice.png' },
      { id: 'S_x_Rare', path: './dice/swift_rolling_blue_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_blue_dice.png' },
      { id: 'S_x_Epic', path: './dice/swift_rolling_purple_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_purple_dice.png' },
      { id: 'S_x_Unique', path: './dice/swift_rolling_orange_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_orange_dice.png' },
      { id: 'S_x_Legendry', path: './dice/swift_rolling_green_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_green_dice.png' },
    ];

    const loaded = [];
    for (const file of diceFiles) {
      await new Promise((resolve) => {
        const img = new Image();
        img.src = `${process.env.PUBLIC_URL}/dice/${file.path}`; // 경로 주의
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
        img.onerror = () => resolve();
      });
    }
    templatesRef.current = loaded;
  };

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

  // [변경 1] handleMouseDown 등 삭제됨

  const analyzeFrame = async () => {
    if (!videoRef.current || !isReady || templatesRef.current.length === 0) return;
    const cv = window.cv;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // 1. 화면 그리기
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    // [변경 3] 현재 캔버스 크기에 맞춰 ROI 좌표 계산
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

    // OCR용 클린 캔버스 생성
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = cw; cleanCanvas.height = ch;
    const cleanCtx = cleanCanvas.getContext('2d');
    cleanCtx.drawImage(canvas, 0, 0);

    // [변경 2] ROI 시각화 (사용자에게 항상 보여줌)
    // Attributes 영역 (노란색)
    ctx.save();
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(attrRect.x, attrRect.y, attrRect.w, attrRect.h);
    ctx.fillStyle = '#ffff00';
    ctx.font = 'bold 12px Arial';
    ctx.fillText("OCR AREA", attrRect.x, attrRect.y - 5);
    
    // Site 영역 (하늘색)
    ctx.strokeStyle = '#00bfff';
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(siteRect.x, siteRect.y, siteRect.w, siteRect.h);
    ctx.fillText("SITE AREA", siteRect.x, siteRect.y - 5);

    // Dice 영역 (초록색)
    ctx.strokeStyle = '#00ff00';
    ctx.strokeRect(diceRect.x, diceRect.y, diceRect.w, diceRect.h);
    ctx.fillText("DICE AREA", diceRect.x, diceRect.y - 5);
    ctx.restore();

    // 3. 이미지 전처리
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    // 4. SITE 매칭 & DICE 매칭 (동적 좌표 적용)
    // OpenCV Rect 생성
    const siteROI = new cv.Rect(siteRect.x, siteRect.y, siteRect.w, siteRect.h);
    const diceROI = new cv.Rect(diceRect.x, diceRect.y, diceRect.w, diceRect.h);
    
    // 안전 장치
    if (siteRect.x + siteRect.w > gray.cols) siteRect.w = gray.cols - siteRect.x;
    if (siteRect.y + siteRect.h > gray.rows) siteRect.h = gray.rows - siteRect.y;
    if (diceRect.x + diceRect.w > gray.cols) diceRect.w = gray.cols - diceRect.x;
    if (diceRect.y + diceRect.h > gray.rows) diceRect.h = gray.rows - diceRect.y;

    let graySiteROI = gray.roi(siteROI);
    let grayDiceROI = gray.roi(diceROI); // 주사위 검색용 ROI

    let enlargedSiteROI = new cv.Mat();
    let enlargedSize = new cv.Size(siteROI.width * 2, siteROI.height * 2);
    cv.resize(graySiteROI, enlargedSiteROI, enlargedSize, 0, 0, cv.INTER_CUBIC);

    const scales = lastSuccessfulScale.current ? [lastSuccessfulScale.current] : [0.8, 0.9, 1.0, 1.1, 1.2];
    let diceCandidates = [];
    let siteCandidates = [];

    // 5. 템플릿 매칭
    templatesRef.current.forEach((tmpl) => {
      const isSiteCategory = tmpl.id.startsWith('S_');
      // [최적화] 주사위는 diceROI, 사이트는 enlargedSiteROI 에서만 검색
      const searchImg = isSiteCategory ? enlargedSiteROI : grayDiceROI;

      scales.forEach((s) => {
        let currentScale = isSiteCategory ? (s * 2.0) : s;
        let resizedTmpl = new cv.Mat();
        
        // 템플릿 리사이즈 시 크기 체크
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
                // diceROI 내부 좌표이므로 전체 좌표로 변환 필요
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

    // NMS 함수
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

    // 스케일 업데이트
    if (finalDice.length >= 2) lastSuccessfulScale.current = finalDice[0].usedScale;

    // 결과 그리기
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
      ctx.fillText(`${s.id}`, s.x, s.y - 5);
    });

    // 6. OCR 실행 (동적 ROI 사용)
    let ocrResult = { rawText: "", effects: [] };
    if (attrRect.w > 20 && attrRect.h > 10) {
      ocrResult = await runOCR(cleanCanvas, attrRect);
    }

    // 7. 조건 검증 및 점수 계산 로직
    const checkCondition = (condition, dice) => {
      const text = condition.toLowerCase().trim();
      if (!text) return true;

      const getVal = (idx) => parseInt(dice[idx]?.id || 0);
      const ordinals = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };

      // (1) "add up to" (지정된 각 주사위가 특정 값 이상인지 확인)
      if (text.includes("add up to")) {
        const targetIndices = [];
        Object.keys(ordinals).forEach(ord => {
          if (text.includes(ord)) targetIndices.push(ordinals[ord]);
        });
        
        // 특정 주사위 언급 없으면 전체 주사위 대상
        if (targetIndices.length === 0) {
            dice.forEach((_, i) => targetIndices.push(i));
        }

        const targetMatch = text.match(/(\d+)/);
        const target = targetMatch ? parseInt(targetMatch[1]) : 0;
        
        if (targetIndices.length > 0 && target > 0) {
            // "or more"가 있거나 일반적인 경우, 모든 대상 주사위가 target 이상이어야 함
            return targetIndices.every(idx => {
                const d = dice[idx];
                return d && parseInt(d.id) >= target;
            });
        }
      }

      // (2) "consecutive numbers" (연속된 숫자)
      if (text.includes("consecutive numbers")) {
        if (dice.length < 2) return false;
        const vals = dice.map(d => parseInt(d.id)).sort((a, b) => a - b);
        for (let i = 0; i < vals.length - 1; i++) {
          if (vals[i+1] !== vals[i] + 1) return false;
        }
        return true;
      }

      // (3) "even number" / "odd number" (홀수/짝수 확인)
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

      // 명시된 조건이 없으면 기본적으로 활성화 (true)
      return true;
    };

    let totalBonus = 0;
    let multiplierSum = 0; // 변수명 변경 (Bonus -> Sum)

    // Site Dice Effects 정의
    const SITE_VALUES = {
      'S_+': { // Blessed Dice: Total 증가
          'Common': { total: 3, multi: 0 },
          'Rare': { total: 6, multi: 0 },
          'Epic': { total: 9, multi: 0 },
          'Unique': { total: 12, multi: 0 },
          'Legendry': { total: 15, multi: 0 },
      },
      'S_+x': { // Holy Rollers: Total + Multiplier
          'Common': { total: 1, multi: 1.4 },
          'Rare': { total: 1, multi: 1.6 },
          'Epic': { total: 1, multi: 1.8 },
          'Unique': { total: 1, multi: 2.0 },
          'Legendry': { total: 1, multi: 2.2 }
      },
      'S_x': { // Swift Rolling Dice: Multiplier only
          'Common': { total: 0, multi: 1.2 },
          'Rare': { total: 0, multi: 1.4 },
          'Epic': { total: 0, multi: 1.6 },
          'Unique': { total: 0, multi: 1.8 },
          'Legendry': { total: 0, multi: 2.0 }
      },
      'S_-x': { // Sharp Edged Dice: Negative Total + High Multiplier
          'Common': { total: -1, multi: 1.6 },
          'Rare': { total: -1, multi: 1.8 },
          'Epic': { total: -1, multi: 2.0 },
          'Unique': { total: -1, multi: 2.2 },
          'Legendry': { total: -1, multi: 2.4 }
      }
    };

    // Site 효과 적용
    finalSites.forEach(site => {
      // ID 형식: S_type_Rank (예: S_+_Common, S_+x_Rare)
      // 뒤에서부터 _로 분리하여 Rank 추출
      const parts = site.id.split('_');
      if (parts.length >= 3) {
        const rank = parts.pop(); // Common, Rare ...
        const type = parts.join('_'); // S_+, S_+x ...
        
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

    // 기본 합계 (주사위 눈금 합)
    const baseSum = finalDice.reduce((acc, d) => acc + parseInt(d.id || 0), 0);
    
    // 최종 배율: 추출된 배율들의 합 (없으면 기본 1.0)
    // 사용자의 요청에 따라 1.0 + alpha가 아닌 alpha 합계 그 자체를 사용
    const finalMultiplier = multiplierSum > 0 ? multiplierSum : 1.0;
    
    // 최종 점수: 소수점 이하 버림 처리
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
      // 계산 결과 추가
      calculation: {
        baseSum,
        totalBonus,
        finalMultiplier: parseFloat(finalMultiplier.toFixed(2)), // 숫자형으로 유지하거나 포맷팅
        finalScore // 정수형
      }
    });

    src.delete(); gray.delete(); 
    graySiteROI.delete(); grayDiceROI.delete(); enlargedSiteROI.delete();
  };

  // OCR 및 파싱 함수
  const runOCR = async (mainCanvas, region) => {
    const cv = window.cv;
    let src = cv.imread(mainCanvas);
    let rect = new cv.Rect(region.x, region.y, region.w, region.h);
    let roi = src.roi(rect);

    let enlarged = new cv.Mat();
    let scale = 3.0; // 스케일 약간 증가 (인식률 향상)
    let dsize = new cv.Size(region.w * scale, region.h * scale);
    cv.resize(roi, enlarged, dsize, 0, 0, cv.INTER_CUBIC);
    cv.cvtColor(enlarged, enlarged, cv.COLOR_RGBA2GRAY, 0);

    // [개선] 이진화 및 반전 처리 (Tesseract는 흰 배경에 검은 글자를 가장 잘 인식함)
    // 1. 오츠 알고리즘으로 이진화 (텍스트/배경 분리)
    cv.threshold(enlarged, enlarged, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    // 2. 색상 반전 (검은 배경/흰 글자 -> 흰 배경/검은 글자)
    // 게임 UI가 보통 어두운 배경에 밝은 글씨이므로, 이진화 후 반전시키면 흰 배경에 검은 글씨가 됨
    cv.bitwise_not(enlarged, enlarged);
   
    const tempCanvas = document.createElement('canvas');
    cv.imshow(tempCanvas, enlarged);

    // [개선] 화이트리스트 적용으로 오인식 방지
    const { data: { text } } = await Tesseract.recognize(tempCanvas, 'eng', {
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:,.+-!% '
    });
    
    src.delete(); roi.delete(); enlarged.delete();

  // 1. 텍스트 전처리: 불필요한 노이즈 제거 및 줄바꿈 정리
    // 줄바꿈을 공백으로 치환하여 한 문장이 끊기는 것을 방지합니다.
    const normalizedText = text.replace(/\n/g, " ");

    const parsedEffects = [];
    
    // 2. 문장 분리: "If" 또는 "Prevents"를 기준으로 문장을 쪼개어 분석 (긍정 앞방향 탐색 사용)
    const sentences = normalizedText.split(/(?=If|Prevents)/i);

    sentences.forEach(sentence => {
      const trimmed = sentence.trim();
      if (trimmed.length < 5) return;

      const totalMatch = trimmed.match(patterns.diceTotal);
      const multiMatch = trimmed.match(patterns.multiplier);
      const isPrevents = /prevents/i.test(trimmed);

      if (totalMatch || multiMatch || isPrevents) {
        // 효과 수치가 시작되는 위치를 찾아 그 앞부분을 조건으로 추출
        let effectIndex = trimmed.length;
        if (totalMatch && totalMatch.index < effectIndex) effectIndex = totalMatch.index;
        if (multiMatch && multiMatch.index < effectIndex) effectIndex = multiMatch.index;

        // 조건 텍스트 정제
        let conditionText = trimmed.substring(0, effectIndex).replace(/[:;.,-]$/, "").trim();
        
        // "Prevents"가 포함된 경우 항상 활성화되도록 condition을 비우거나 특수 처리
        // (checkCondition에서 빈 문자열은 true를 반환함)
        if (isPrevents && !/if/i.test(conditionText)) {
            // "If"가 없는 Prevents 문장은 상시 효과로 취급
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

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100vh', padding: '20px' }}>
      <h2>Mystic Frontier Calculator</h2>
      <button onClick={startScreenCapture} disabled={!isReady} style={{ padding: '10px 20px', marginBottom: '20px' }}>Select Maplestory</button>

      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ position: 'relative' }}>
          {/* 마우스 이벤트 제거됨 */}
          <canvas ref={canvasRef} width="1280" height="720" style={{ width: '800px', border: '1px solid #444' }} />
          <video ref={videoRef} style={{ display: 'none' }} muted />
        </div>

        <div style={{ flex: 1, background: '#252525', padding: '15px', borderRadius: '8px', overflowY: 'auto', maxHeight: '720px' }}>
          <h3>📋 Result </h3>
          
          {/* 최종 점수 패널 수정 */}
          {analysisResult.calculation && (
            <div style={{ marginBottom: '20px', padding: '15px', background: '#333', borderRadius: '8px', border: '2px solid gold' }}>
                <h2 style={{ margin: '0 0 15px 0', color: 'gold', textAlign: 'center' }}>{analysisResult.calculation.finalScore}</h2>
                
                {/* 요청된 레이아웃: Total + Dice * Multiplier */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center', textAlign: 'center', gap: '5px' }}>
                    {/* Headers */}
                    <div style={{ fontSize: '11px', color: '#aaa', paddingBottom: '5px' }}>Total</div>
                    <div></div>
                    <div style={{ fontSize: '11px', color: '#aaa', paddingBottom: '5px' }}>Dice</div>
                    <div></div>
                    <div style={{ fontSize: '11px', color: '#aaa', paddingBottom: '5px' }}>Multiplier</div>

                    {/* Values */}
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#00ff00' }}>{analysisResult.calculation.totalBonus}</div>
                    <div style={{ color: '#aaa' }}>+</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{analysisResult.calculation.baseSum}</div>
                    <div style={{ color: '#aaa' }}>*</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#00bfff' }}>{analysisResult.calculation.finalMultiplier}</div>
                </div>
            </div>
          )}

          <hr style={{ borderColor: '#444' }} />
         
          <h4>🎲 DICE</h4>
          {analysisResult.diceDetails.length > 0 ? analysisResult.diceDetails.map((d, i) => (
            <div key={i} style={{ fontSize: '12px', marginBottom: '4px', padding: '4px', background: '#333', borderLeft: '4px solid #00ff00' }}>
              Dice{i+1} : {d.id} ({d.accuracy}%)
            </div>
          )) : <p style={{ fontSize: '12px', color: '#888' }}>Empty</p>}

          <hr style={{ borderColor: '#444' }} />
          
          <h4 style={{ marginTop: '20px' }}>🎲 Add Dice</h4>
          {analysisResult.siteDetails.length > 0 ? analysisResult.siteDetails.map((s, i) => (
            <div key={i} style={{ fontSize: '12px', marginBottom: '8px', padding: '8px', background: '#333', borderRadius: '4px', borderLeft: '4px solid #00bfff' }}>
              <strong>{s.id}</strong> <br/>
              <span style={{ color: '#ffeb3b' }}>RGB: ({s.r}, {s.g}, {s.b})</span>
            </div>
          )) : <p style={{ fontSize: '12px', color: '#888' }}>Empty</p>}
          
          <hr style={{ borderColor: '#444' }} />

          <h4 style={{ marginTop: '20px' }}>Attributes</h4>
          {/* 파싱된 수치 데이터를 깔끔하게 보여줌 */}
          {analysisResult.parsedEffects.length > 0 ? (
              analysisResult.parsedEffects.map((eff, i) => (
                  <div key={i} style={{ 
                      marginBottom: '5px', padding: '5px', 
                      background: eff.isActive ? '#2a3b2a' : '#333', // 활성 시 초록빛 배경
                      borderLeft: eff.isActive ? '3px solid #00ff00' : '3px solid #555',
                      opacity: eff.isActive ? 1 : 0.6
                  }}>
                      <div style={{fontSize: '11px', color: eff.isActive ? '#fff' : '#aaa'}}>
                        {eff.condition ? `${eff.condition}` : '[Passive] Always Active'}
                      </div>
                      <div style={{fontSize: '13px', fontWeight: 'bold', color: '#fff'}}>
                        {eff.diceTotal !== 0 && <span>Total {eff.diceTotal > 0 ? '+' : ''}{eff.diceTotal} </span>}
                        {eff.multiplier !== 0 && <span>Multiplier {eff.multiplier}x</span>}
                      </div>
                  </div>
              ))
          ) : (
              <p style={{ fontSize: '12px', color: '#888' }}>Empty</p>
          )}

          <details style={{marginTop: '10px'}}>
            <summary style={{cursor: 'pointer', fontSize: '12px', color: '#888'}}>Raw Text</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px', color: '#aaa', padding: '5px' }}>
                {analysisResult.attributesText}
            </pre>
          </details>

        </div>
      </div>
    </div>
  );
};

export default App;