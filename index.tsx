import React, { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

const App = () => {
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoSrc, setVideoSrc] = useState<string>('');
    const [prompt, setPrompt] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [resultImages, setResultImages] = useState<{src: string, reason: string}[]>([]);
    const [error, setError] = useState<string>('');

    const allFramesRef = useRef<string[]>([]);

    const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setVideoFile(file);
            const url = URL.createObjectURL(file);
            setVideoSrc(url);
            setResultImages([]);
            setError('');
        }
    };

    const extractFrames = useCallback(async (file: File): Promise<string[]> => {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(file);
            video.muted = true;

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const frames: string[] = [];

            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                video.currentTime = 0;
            };

            video.onseeked = async () => {
                if (!context) {
                    reject(new Error("Không thể lấy context của canvas."));
                    return;
                }
                context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                // Giảm chất lượng để tăng tốc độ và giảm kích thước dữ liệu
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8); 
                frames.push(dataUrl.split(',')[1]); // Chỉ lấy dữ liệu base64

                const nextTime = video.currentTime + 1; // Lấy 1 khung hình mỗi giây
                setStatusMessage(`Đang trích xuất khung hình... (${frames.length} / ${Math.floor(video.duration)})`);
                
                if (nextTime <= video.duration) {
                    video.currentTime = nextTime;
                } else {
                    resolve(frames);
                }
            };

            video.onerror = (e) => {
                reject(new Error("Lỗi khi tải video."));
            };
            
            video.load();
        });
    }, []);


    const handleProcessVideo = async () => {
        if (!videoFile || !prompt) {
            setError("Vui lòng chọn một video và nhập yêu cầu.");
            return;
        }

        setIsLoading(true);
        setError('');
        setResultImages([]);
        allFramesRef.current = [];

        try {
            const frames = await extractFrames(videoFile);
            allFramesRef.current = frames;
            
            if (frames.length === 0) {
                throw new Error("Không thể trích xuất khung hình nào từ video.");
            }

            setStatusMessage("Đang phân tích video với AI, vui lòng đợi...");

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            
            const model = 'gemini-2.5-pro';

            const systemInstruction = `Bạn là một chuyên gia phân tích video. Nhiệm vụ của bạn là xem xét một chuỗi các khung hình video và xác định những khung hình phù hợp nhất với yêu cầu của người dùng.
            Yêu cầu của người dùng là: "${prompt}".
            Chỉ trả về các khung hình chính xác nhất.
            Trả về một đối tượng JSON có cấu trúc là một mảng tên là 'scenes'. Mỗi đối tượng trong mảng phải có hai thuộc tính: 'frameIndex' (chỉ số của khung hình khớp trong chuỗi đầu vào) và 'reason' (một mô tả ngắn gọn tại sao khung hình này được chọn).`;

            const contents = [
                { text: systemInstruction },
                ...frames.map(data => ({ inlineData: { mimeType: 'image/jpeg', data } })),
            ];

            const response = await ai.models.generateContent({
                model,
                contents: { parts: contents },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            scenes: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        frameIndex: { type: Type.INTEGER },
                                        reason: { type: Type.STRING },
                                    },
                                    required: ["frameIndex", "reason"]
                                }
                            }
                        }
                    }
                }
            });
            
            const jsonResponse = JSON.parse(response.text);

            if (!jsonResponse.scenes || jsonResponse.scenes.length === 0) {
                setError("AI không tìm thấy cảnh nào phù hợp với yêu cầu của bạn.");
            } else {
                const finalImages = jsonResponse.scenes
                    .map((scene: { frameIndex: number, reason: string }) => {
                        if (scene.frameIndex < allFramesRef.current.length) {
                            return {
                                src: `data:image/jpeg;base64,${allFramesRef.current[scene.frameIndex]}`,
                                reason: scene.reason
                            };
                        }
                        return null;
                    })
                    .filter(Boolean); // Lọc bỏ các giá trị null
                
                setResultImages(finalImages);
            }

        } catch (e: any) {
            console.error(e);
            setError(`Đã xảy ra lỗi: ${e.message}`);
        } finally {
            setIsLoading(false);
            setStatusMessage('');
        }
    };

    const handleDownload = (src: string, index: number) => {
        const link = document.createElement('a');
        link.href = src;
        link.download = `phancanh_${index + 1}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePreview = (src: string) => {
        const newWindow = window.open();
        newWindow?.document.write(`<body style="margin:0; background:#222;"><img src="${src}" style="width:100%; height:auto; display:block; margin:auto;"></body>`);
    };

    return (
        <>
            <h1>🎬 Phân cảnh Video</h1>
            <main className="main-container">
                <section className="panel control-panel" aria-labelledby="control-panel-heading">
                    <h2 id="control-panel-heading">Bảng điều khiển</h2>
                    <div className="control-group">
                        <label htmlFor="video-upload">1. Tải lên Video của bạn</label>
                        <input id="video-upload" type="file" accept="video/*" onChange={handleVideoChange} />
                    </div>
                    
                    {videoSrc && (
                        <video id="video-preview" src={videoSrc} controls>
                            Trình duyệt của bạn không hỗ trợ thẻ video.
                        </video>
                    )}

                    <div className="control-group">
                        <label htmlFor="prompt-input">2. Mô tả cảnh cần cắt</label>
                        <textarea
                            id="prompt-input"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Ví dụ: tìm tất cả các cảnh có một chiếc ô tô màu đỏ đang chạy trên đường"
                        />
                    </div>
                    
                    <button className="action-button" onClick={handleProcessVideo} disabled={isLoading || !videoFile || !prompt}>
                        {isLoading ? 'Đang xử lý...' : 'Bắt đầu cắt cảnh'}
                    </button>
                    {error && <div className="error-message">{error}</div>}
                </section>
                
                <section className="panel result-panel" aria-labelledby="result-panel-heading">
                    <h2 id="result-panel-heading">Kết quả</h2>
                    {isLoading ? (
                        <div className="status-container">
                            <div className="spinner"></div>
                            <p>{statusMessage}</p>
                        </div>
                    ) : resultImages.length > 0 ? (
                        <div className="result-grid">
                            {resultImages.map((image, index) => (
                                <div key={index} className="result-item" title={image.reason}>
                                    <img src={image.src} alt={`Kết quả phân cảnh ${index + 1}`} />
                                    <div className="result-item-overlay">
                                        <button className="overlay-button" onClick={() => handlePreview(image.src)}>Xem trước</button>
                                        <button className="overlay-button" onClick={() => handleDownload(image.src, index)}>Tải xuống</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="placeholder">
                            <p>Kết quả hình ảnh đã cắt sẽ được hiển thị ở đây.</p>
                        </div>
                    )}
                </section>
            </main>
        </>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
