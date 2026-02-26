import { useState, useEffect } from "react";

interface PythonPath {
    path: string;
    selected: boolean;
}

interface ServerError {
    message: string;
    type: string;
}

export default function App() {
    const [pythonPaths, setPythonPaths] = useState<PythonPath[]>([]);
    const [error, setError] = useState<ServerError | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [serverOk, setServerOk] = useState(false);

    useEffect(() => {
        async function fetchData() {
            try {
                const [pathsRes, statusRes] = await Promise.all([
                    fetch("/api/python-paths"),
                    fetch("/api/status")
                ]);
                
                const pathsData = await pathsRes.json();
                const statusData = await statusRes.json();
                
                if (statusData.error) {
                    setError(statusData.error);
                    setServerOk(false);
                } else {
                    setError(null);
                    setServerOk(true);
                }
                
                if (pathsData.paths && pathsData.paths.length > 0) {
                    setPythonPaths(pathsData.paths.map((path: string) => ({
                        path,
                        selected: path === pathsData.savedPath
                    })));
                } else {
                    setPythonPaths([{ path: "python", selected: true }]);
                }
            } catch (e) {
                setError({ message: "无法连接到服务器", type: "connection" });
            } finally {
                setLoading(false);
            }
        }
        
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleSelect = (path: string) => {
        setPythonPaths(pythonPaths.map(p => ({
            ...p,
            selected: p.path === path
        })));
    };

    const handleSave = async () => {
        const selected = pythonPaths.find(p => p.selected);
        if (!selected) return;
        
        setSaving(true);
        try {
            const res = await fetch("/api/python-path", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: selected.path })
            });
            const data = await res.json();
            if (data.success) {
                alert("Python 路径保存成功！请刷新页面");
            } else {
                alert("保存失败: " + data.error);
            }
        } catch (e) {
            alert("保存失败");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="w-screen h-screen flex justify-center items-center">
                <div className="text-gray-400">加载中...</div>
            </div>
        );
    }

    return (
        <div className="w-screen h-screen flex justify-center items-center">
            <div className=" bg-gray-50 max-w-xl w-full shadow-md rounded-2xl p-6 md:p-8 mx-4">
                <div className="flex flex-col gap-5">
                    <h1 className="text-2xl font-semibold text-gray-800 tracking-tight">
                        更好的学而思编程助手
                    </h1>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                            <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span className="text-red-700 font-medium text-sm">错误</span>
                            </div>
                            <p className="text-red-600 mt-1 text-sm">{error.message}</p>
                        </div>
                    )}

                    {serverOk && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                            <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-green-700 font-medium text-sm">服务正常运行</span>
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="pythonPath" className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                                Python 解释器
                            </label>
                            <div className="space-y-1.5">
                                {pythonPaths.map((p) => (
                                    <label
                                        key={p.path}
                                        className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                                            p.selected
                                                ? "border-gray-500/20 bg-gray-200 text-white"
                                                : "border-gray-200 hover:border-gray-300"
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="pythonPath"
                                            checked={p.selected}
                                            onChange={() => handleSelect(p.path)}
                                            className="w-3.5 h-3.5 text-blue-600"
                                        />
                                        <span className="text-sm text-gray-700">{p.path}</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                                选择一个 Python 解释器路径
                            </p>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="px-5 py-1.5 bg-black disabled:bg-gray-400 text-white rounded-lg shadow-sm transition-colors text-sm font-medium"
                        >
                            {saving ? "保存中..." : "保存设置"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}