import React, { useEffect, useRef, useState } from 'react';

import Tesseract from 'tesseract.js';

import Fuse from 'fuse.js'; // npm install fuse.js


const App = () => {

  const [isReady, setIsReady] = useState(false);

  const [analysisResult, setAnalysisResult] = useState({

    attributes: '',

    diceDetails: [],

    siteDetails: [] // Site Details 결과 추가

  });

 
  // att 범위
  const [attrRegion, setAttrRegion] = useState({ x: 300, y: 475, w: 670, h: 90 });

  // site 범위
  // const [attrRegion, setAttrRegion] = useState({ x: 460, y: 555, w: 350, h: 52 });
  const attrRegionRef = useRef(attrRegion);



  const isDragging = useRef(false);

  const startPos = useRef({ x: 0, y: 0 });



  const videoRef = useRef(null);

  const canvasRef = useRef(null);

  const templatesRef = useRef([]);



  // 주사위 스케일 최적화를 위한 Ref

  const lastSuccessfulScale = useRef(null);



  // Fuse.js

  const ATTRIBUTE_LIST = [

      "all", "Familiars", "active", "lineup",

      "have", "same", "type", "element",

      "Final Multiplier:", "Dice Total:"

    ];



  const fuse = new Fuse(ATTRIBUTE_LIST, {

    threshold: 0.4,

    distance: 100

  });



  useEffect(() => {

    attrRegionRef.current = attrRegion;

  }, [attrRegion]);



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
    const srcHSV = new cv.Mat();
    cv.cvtColor(srcRGB, srcHSV, cv.COLOR_RGB2HSV);

    const mean = cv.mean(srcHSV);
    const hue = Math.round(mean[0]); // 정수로 반올림
    const sat = Math.round(mean[1]);

    roi.delete(); srcRGB.delete(); srcHSV.delete();

    // 등급 판별 로직
    let rank = 'Common';
    if (sat < 40) rank = 'Common';
    else if (hue < 25 || hue > 165) rank = 'Unique';
    else if (hue >= 35 && hue <= 85) rank = 'Legendry';
    else if (hue >= 90 && hue <= 130) rank = 'Rare';
    else if (hue >= 131 && hue <= 160) rank = 'Epic';

    // [수정됨] 등급과 Hue, Sat 값을 함께 반환
    return { rank, hue, sat };
  };

  const loadTemplates = async () => {

    const cv = window.cv;

    const diceFiles = [

      { id: '1', path: 'dice_1.png' }, { id: '2', path: 'dice_2.png' },
      { id: '3', path: 'dice_3.png' }, { id: '4', path: 'dice_4.png' },   
      { id: '5', path: 'dice_5.png' }, { id: '6', path: 'dice_6.png' },

      { id: 'S_+_Common', path: './dice/blessed_gray_dice.png' },    //{ id: 'S_+_Rare', path: 'blessed_gray_dice.png' },
      { id: 'S_+_Rare', path: './dice/blessed_blue_dice.png' },      //{ id: 'S_+_Rare', path: 'blessed_blue_dice.png' },
      { id: 'S_+_Epic', path: './dice/blessed_purple_dice.png' },    //{ id: 'S_+_Rare', path: 'blessed_purple_dice.png' },
      { id: 'S_+_Unique', path: './dice/blessed_orange_dice.png' },  //{ id: 'S_+_Rare', path: 'blessed_orange_dice.png' },
      { id: 'S_+_Legendry', path: './dice/blessed_green_dice.png' }, //{ id: 'S_+_Rare', path: 'blessed_green_dice.png' },

      { id: 'S_+x_Common', path: './dice/gray_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'gray_holy_rollers.png' },
      { id: 'S_+x_Rare', path: './dice/blue_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'blue_holy_rollers.png' },
      { id: 'S_+x_Epic', path: './dice/purple_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'purple_holy_rollers.png' },
      { id: 'S_+x_Unique', path: './dice/orange_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'orange_holy_rollers.png' },
      { id: 'S_+x_Legendry', path: './dice/green_holy_rollers.png' }, //{ id: 'S_+_Rare', path: 'green_holy_rollers.png' },

      { id: 'S_-x_Common', path: './dice/sharp_edged_gray_dice.png' }, { id: 'S_-x_Common', path: 'sharp_edged_gray_dice.png' },
      { id: 'S_-x_Rare', path: './dice/sharp_edged_blue_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_blue_dice.png' },
      { id: 'S_-x_Epic', path: './dice/sharp_edged_purple_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_purple_dice.png' },
      { id: 'S_-x_Unique', path: './dice/sharp_edged_orange_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_orange_dice.png' },
      { id: 'S_-x_Legendry', path: './dice/sharp_edged_green_dice.png' }, //{ id: 'S_+_Rare', path: 'sharp_edged_green_dice.png' },

      { id: 'S_x_Common', path: './dice/swift_rolling_gray_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_gray_dice.png' },
      { id: 'S_x_Rare', path: './dice/swift_rolling_blue_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_blue_dice.png' },
      { id: 'S_x_Epic', path: './dice/swift_rolling_purple_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_purple_dice.png' },
      { id: 'S_x_Unique', path: './dice/swift_rolling_orange_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_orange_dice.png' },
      { id: 'S_x_Legendry', path: './dice/swift_rolling_green_dice.png' }, //{ id: 'S_+_Rare', path: 'swift_rolling_green_dice.png' },
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



  const handleMouseDown = (e) => {

    const rect = canvasRef.current.getBoundingClientRect();

    const scaleX = canvasRef.current.width / rect.width;

    const scaleY = canvasRef.current.height / rect.height;

    isDragging.current = true;

    startPos.current = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };

  };



  const handleMouseMove = (e) => {

    if (!isDragging.current) return;

    const rect = canvasRef.current.getBoundingClientRect();

    const scaleX = canvasRef.current.width / rect.width;

    const scaleY = canvasRef.current.height / rect.height;

    const currentX = (e.clientX - rect.left) * scaleX;

    const currentY = (e.clientY - rect.top) * scaleY;



    setAttrRegion({

      x: Math.min(startPos.current.x, currentX),

      y: Math.min(startPos.current.y, currentY),

      w: Math.abs(currentX - startPos.current.x),

      h: Math.abs(currentY - startPos.current.y)

    });

  };



  const handleMouseUp = () => { isDragging.current = false; };


const analyzeFrame = async () => {
    if (!videoRef.current || !isReady || templatesRef.current.length === 0) return;
    const cv = window.cv;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 1. 화면 그리기
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    // 2. OCR 영역 표시
    const aReg = attrRegionRef.current;
// --- [중요] OCR을 위한 '깨끗한 복사본' 만들기 ---
    // 박스와 글자가 그려지기 전의 상태를 새로운 캔버스에 복사해둡니다.
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = canvas.width;
    cleanCanvas.height = canvas.height;
    const cleanCtx = cleanCanvas.getContext('2d');
    cleanCtx.drawImage(canvas, 0, 0);

    // 2. OCR 영역 가이드 그리기 (사용자에게 보여주기 위함)
    if (aReg && aReg.w > 0 && aReg.h > 0) {
      ctx.save();
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(aReg.x, aReg.y, aReg.w, aReg.h);
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 14px Arial';
      ctx.fillText("OCR AREA", aReg.x, aReg.y - 5);
      ctx.restore();
    }

    // 3. 이미지 전처리
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    // 4. SITE 전용 ROI 설정 및 2배 업스케일
    const siteROI = new cv.Rect(460, 555, 350, 52);
    let graySiteROI = gray.roi(siteROI);
    let enlargedSiteROI = new cv.Mat();
    let enlargedSize = new cv.Size(siteROI.width * 2, siteROI.height * 2);
    
    // INTER_CUBIC 보간법으로 화질을 유지하며 확대
    cv.resize(graySiteROI, enlargedSiteROI, enlargedSize, 0, 0, cv.INTER_CUBIC);

    const scales = lastSuccessfulScale.current ? [lastSuccessfulScale.current] : [0.8, 0.9, 1.0, 1.1, 1.2];
    let diceCandidates = [];
    let siteCandidates = [];

    // 5. 템플릿 매칭 루프
    templatesRef.current.forEach((tmpl) => {
      const isSiteCategory = tmpl.id.startsWith('S_');
      // 검색 대상: SITE는 확대된 이미지, 일반은 원본 Gray
      const searchImg = isSiteCategory ? enlargedSiteROI : gray;

      scales.forEach((s) => {
        // SITE 템플릿은 2배 키워서 비교
        let currentScale = isSiteCategory ? (s * 2.0) : s;

        let resizedTmpl = new cv.Mat();
        cv.resize(
          tmpl.grayMat, 
          resizedTmpl, 
          new cv.Size(Math.round(tmpl.grayMat.cols * currentScale), Math.round(tmpl.grayMat.rows * currentScale)), 
          0, 0, 
          cv.INTER_CUBIC 
        );
        
        let dst = new cv.Mat();
        cv.matchTemplate(searchImg, resizedTmpl, dst, cv.TM_CCOEFF_NORMED);

        let data = dst.data32F;
        // SITE는 확대했으므로 0.6, 일반 주사위는 0.7
        const threshold = isSiteCategory ? 0.6 : 0.7; 

        for (let row = 0; row < dst.rows; row += 2) {
          for (let col = 0; col < dst.cols; col += 2) {
            const score = data[row * dst.cols + col];
            
            if (score > threshold) {
              if (isSiteCategory) {
                // [SITE] 확대된 좌표계를 다시 0.5배로 축소 + ROI 오프셋 보정
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
                // [일반 주사위] 누락되었던 로직 복구
                // SITE ROI 영역 내부에서 발견된 것은 무시 (중복 방지)
                const centerX = col + (resizedTmpl.cols / 2);
                const centerY = row + (resizedTmpl.rows / 2);
                
                // 해당 좌표가 SITE ROI 안에 있는지 확인
                const isInSiteROI = (
                    centerX > siteROI.x && centerX < siteROI.x + siteROI.w &&
                    centerY > siteROI.y && centerY < siteROI.y + siteROI.h
                );

                if (!isInSiteROI) {
                    diceCandidates.push({
                        id: tmpl.id,
                        score: score,
                        x: col,
                        y: row,
                        w: resizedTmpl.cols,
                        h: resizedTmpl.rows,
                        usedScale: s
                    });
                }
              }
            }
          }
        }
        resizedTmpl.delete(); dst.delete();
      });
    });

    // NMS 함수 (내부 정의)
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

    // 최종 결과 도출
    // const finalDice = applyNMS(diceCandidates, 0.2).sort((a, b) => a.x - b.x);
    // const finalSites = applyNMS(siteCandidates, 0.2);

    // [변경 후] Site 주사위 색상 보정 로직 추가
    const finalDice = applyNMS(diceCandidates, 0.2).sort((a, b) => a.x - b.x);
    
    // NMS 적용 후, 색상 분석을 위해 let으로 선언
    let detectedSites = applyNMS(siteCandidates, 0.2); 

    // === 여기서 각각의 좌표를 이용해 색상을 다시 확인합니다 ===
    const finalSites = detectedSites.map(site => {
      const { rank, hue, sat } = getRankFromROI(cv, src, site);
      const parts = site.id.split('_');
        
      let newId = site.id;
          if (parts.length >= 3) {
              parts[parts.length - 1] = rank;
              newId = parts.join('_');
          }
        
        return {
          ...site,
          id: newId, 
          hue: hue, // UI 출력을 위해 추가
          sat: sat  // 채도도 같이 확인하면 편리합니다;
        };
    });    

    // 스케일 최적화 업데이트
    if (finalDice.length >= 2) {
      lastSuccessfulScale.current = finalDice[0].usedScale;
    } else {
      lastSuccessfulScale.current = null;
    }

    // --- 그리기 로직 ---
    // SITE ROI 가이드 (디버깅)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(siteROI.x, siteROI.y, siteROI.w, siteROI.h);
    ctx.setLineDash([]);

    // 일반 주사위 그리기
    finalDice.forEach(d => {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 14px Arial';
      // 수정: d.accuracy 대신 d.score를 직접 변환하여 출력
      const acc = (d.score * 100).toFixed(1);
      ctx.fillText(`${d.id} (${acc}%)`, d.x, d.y - 5);
    });

    // SITE 아이콘 그리기
    finalSites.forEach(s => {
      ctx.strokeStyle = '#00bfff';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#00bfff';
      ctx.font = 'bold 12px Arial';
      // 수정: s.accuracy 대신 s.score를 직접 변환하여 출력
      const acc = (s.score * 100).toFixed(1);
      ctx.fillText(`${s.id} (${acc}%)`, s.x, s.y - 5);
    });

    // OCR 실행
// 3. OCR 실행 시 'canvas' 대신 'cleanCanvas'를 넘깁니다.
    let finalAttributes = "";
    if (aReg && aReg.w > 20 && aReg.h > 10) {
      // cleanCanvas를 넘기면 runOCR 내부의 src.roi()가 글자가 없는 이미지를 잘라냅니다.
      finalAttributes = await runOCR(cleanCanvas, aReg);
    }

    // 결과 State 업데이트
    setAnalysisResult({
      attributes: finalAttributes,
      diceDetails: finalDice.map(d => ({...d, accuracy: (d.score * 100).toFixed(1)})),
      siteDetails: finalSites.map(s => ({
          ...s, 
          accuracy: (s.score * 100).toFixed(1),
          hue: s.hue, // 추가
          sat: s.sat  // 추가
      }))
    });

    // 메모리 해제
    src.delete(); gray.delete(); 
    graySiteROI.delete(); enlargedSiteROI.delete();
  };



  // 별도로 분리된 runOCR 함수 (이전과 동일)

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

   

    const tempCanvas = document.createElement('canvas');

    cv.imshow(tempCanvas, enlarged);



    const { data: { text } } = await Tesseract.recognize(tempCanvas, 'eng');

   

    src.delete(); roi.delete(); enlarged.delete();



    const lines = text.split('\n');

    const correctedLines = lines.map(line => {

      const trimLine = line.trim();

      if (trimLine.length < 2) return "";



      const results = fuse.search(trimLine);

      return results.length > 0 ? results[0].item : trimLine;

    });



    return correctedLines.filter(l => l !== "").join('\n');

  };



  return (

    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100vh', padding: '20px' }}>

      <h2>Mystic Frontier 정밀 분석기</h2>

      <button onClick={startScreenCapture} disabled={!isReady} style={{ padding: '10px 20px', marginBottom: '20px' }}>화면 공유 시작</button>



      <div style={{ display: 'flex', gap: '20px' }}>

        <div style={{ position: 'relative' }}>

          <canvas ref={canvasRef} width="1280" height="720" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} style={{ width: '800px', border: '1px solid #444', cursor: 'crosshair' }} />

          <video ref={videoRef} style={{ display: 'none' }} muted />

        </div>



        <div style={{ flex: 1, background: '#252525', padding: '15px', borderRadius: '8px', overflowY: 'auto', maxHeight: '720px' }}>

          <h3>📋 Result </h3>

          <hr style={{ borderColor: '#444' }} />

         

          <h4>🎲 DICE (Value, Pos, Acc)</h4>

          {analysisResult.diceDetails.length > 0 ? analysisResult.diceDetails.map((d, i) => (

            <div key={i} style={{ fontSize: '12px', marginBottom: '8px', padding: '8px', background: '#333', borderRadius: '4px', borderLeft: '4px solid #00ff00' }}>

              <strong>주사위: {d.id}</strong> | 정확도: <span style={{ color: '#00ff00' }}>{d.accuracy}%</span><br/>

              위치: X {d.x}, Y {d.y} (Size: {d.w}x{d.h})

            </div>

          )) : <p style={{ fontSize: '12px', color: '#888' }}>감지된 주사위 없음</p>}



          {/* --- Site Details 섹션 추가 --- */}

          <h4 style={{ marginTop: '20px' }}>📍 SITE Details (Pos, Acc, Hue)</h4>
          {analysisResult.siteDetails.length > 0 ? analysisResult.siteDetails.map((s, i) => (
            <div key={i} style={{ fontSize: '12px', marginBottom: '8px', padding: '8px', background: '#333', borderRadius: '4px', borderLeft: '4px solid #00bfff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>타입: {s.id}</strong>
                <span style={{ color: '#00bfff' }}>{s.accuracy}%</span>
              </div>
              <div style={{ marginTop: '4px', color: '#ccc' }}>
                위치: X {s.x}, Y {s.y} | 
                <span style={{ color: '#ffeb3b', fontWeight: 'bold', marginLeft: '5px' }}>
                  Hue: {s.hue} (Sat: {s.sat})
                </span>
              </div>
            </div>
          )) : <p style={{ fontSize: '12px', color: '#888' }}>감지된 SITE 아이콘 없음</p>}



          <h4 style={{ marginTop: '20px' }}>Attributes</h4>

          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '13px', color: '#ffff00', background: '#000', padding: '10px' }}>{analysisResult.attributes || '드래그하여 영역 지정'}</pre>

        </div>

      </div>

    </div>

  );

};



export default App;