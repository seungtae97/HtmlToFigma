import React, { useState } from 'react';

function App() {
    const [dragActive, setDragActive] = useState(false);
    const [fileName, setFileName] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const processFiles = async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        const validFiles = fileArray.filter(f => f.type === "application/json" || f.name.endsWith('.json'));

        if (validFiles.length === 0) {
            alert("Only JSON files are allowed.");
            return;
        }

        setFileName(validFiles.length === 1 ? validFiles[0].name : `${validFiles.length} files selected`);
        setIsProcessing(true);

        const promises = validFiles.map(file => new Promise<{ name: string, content: any }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = event.target?.result as string;
                    const data = JSON.parse(json);
                    resolve({ name: file.name.replace('.json', ''), content: data });
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        }));

        try {
            const results = await Promise.all(promises);
            parent.postMessage({ pluginMessage: { type: 'import-files', data: results } }, '*');
            setIsProcessing(false);
        } catch (error) {
            alert("Error parsing JSON files.");
            setIsProcessing(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files.length > 0) {
            processFiles(e.target.files);
        }
    };

    return (
        <div style={{ padding: '20px', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>
            <h2>Import Design</h2>
            <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                style={{
                    border: `2px dashed ${dragActive ? '#18A0FB' : '#cfcfcf'}`,
                    borderRadius: '8px',
                    padding: '40px 20px',
                    backgroundColor: dragActive ? '#f0f9ff' : '#fafafa',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer',
                    position: 'relative'
                }}
            >
                <input
                    type="file"
                    id="input-file-upload"
                    accept=".json"
                    multiple
                    onChange={handleChange}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        opacity: 0,
                        cursor: 'pointer'
                    }}
                />

                {isProcessing ? (
                    <div style={{ color: '#18A0FB', fontWeight: 600 }}>Processing...</div>
                ) : (
                    <>
                        <div style={{ fontSize: '32px', marginBottom: '10px' }}>📄</div>
                        <div style={{ fontWeight: 600, color: '#333', marginBottom: '5px' }}>
                            {fileName || "Drag & drop your JSON file"}
                        </div>
                        <div style={{ fontSize: '12px', color: '#888' }}>
                            {fileName ? "Drop another file to replace" : "or click to browse"}
                        </div>
                    </>
                )}
            </div>

            <p style={{ fontSize: '11px', color: '#999', marginTop: '20px', lineHeight: '1.5' }}>
                Export a JSON file using the Chrome extension, then drop it here to generate layers.
            </p>
            <div style={{ marginTop: '15px', fontSize: '11px', color: '#ccc' }}>v1.0.0</div>
        </div>
    );
}

export default App;
