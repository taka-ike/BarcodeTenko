import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Trash2, Download, XCircle, Clock, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from './lib/utils';
//import fs from 'fs';
//import path from 'path';

interface ScanRecord {
  id: string;           //個別で削除するため
  timestamp: number;    
  barcode: string;      //バーコード．手打ちの場合はlast5と同じ
  last5: string;        //学籍番号
  location: string;     //スキャンリストに表示することでなんとなく安心感
  errorMessage?: string;
}

interface SettingsState {
  location: string;
}

export default function App() {
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [scanError, setScanError] = useState<string | null>(null); //これはgeminiの案
  const [settings, setSettings] = useState<SettingsState>({
    location: ''
  });

  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(Date.now());

  const locations = '2棟2階,第一体育館前,本部横'.split(',').map(s => s.trim());
  
  //ここら辺はelectronで動くようにしたためよくわかっていない．
  //ClearHistryを押すと一度ウィンドウを解除するまでinputが押せない
  useEffect(() => {
    const savedRecords = localStorage.getItem('scanRecords');
    if (savedRecords) {
      try {
        setRecords(JSON.parse(savedRecords));
      } catch (error) {
        console.error('Failed save records:', error);
      }
    }
    const savedSettings = localStorage.getItem('settings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (error) {
        console.error('Failed parse settings:', error);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('scanRecords', JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
  }, [settings]);

  const [lastScannedId, setLastScannedId] = useState<string | null>(null);

  
  const triggerError = (message: string) => {
    setScanError(message);
    setTimeout(() => setScanError(null), 300);
  }; //300ms

  const handleScan = useCallback(async (barcode: string) => {
    if (!settings.location) {
      setIsSettingsOpen(true);
      return;
    }

    const last5 = barcode.slice(-5);
    const newId = `${Date.now()}_${last5}`;

    const newRecord: ScanRecord = {
      id: newId,
      timestamp: Date.now(),
      barcode,
      last5,
      location: settings.location
    }; //毎回location 正直いらない

    setRecords(prev => [newRecord, ...prev]);
    setLastScannedId(newId);
    
    /*上手くいかなかったため保留
    try {
      await fetch('http://localhost:3030/save-scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          last5,
          location: settings.location
        }),
      });
    } catch (error) {
      console.error('Failed to send scan to server:', error);
    }*/
    /* あり得ない代替案 by gemini
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(parseInt(last5, 10), 0);
    const uint16 = new Uint16Array(parseInt(last5, 10));
    const blob = new Blob([uint16], { type: 'application/octet-stream' });
    fs.appendFile('ids.bin', blob, (err) => {
      if (err) {
        console.error('Failed to save scan to file:', err);
      }
    });*/
  }, [settings.location, records]);

  //スキャナ．常時キー入力を監視して読み取った値を入力しているが，最後にエンター必須．
  //こちら私に知見がないため，完全にgemini実装です．
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastKeyTimeRef.current > 100) {
        bufferRef.current = '';
      }
      lastKeyTimeRef.current = currentTime;

      if (e.key === 'Enter') {
        if (bufferRef.current.length === 10 && /^\d{10}$/.test(bufferRef.current)) {
          handleScan(bufferRef.current);
        } else {
          triggerError('スキャン失敗');
        }
        bufferRef.current = '';
      } else if (/^\d$/.test(e.key)) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleScan, triggerError]);
  //スキャナおわり 手動入力の動作は下記cssたちのところに

  const generateCSV = () => {
    const header = 'Timestamp,ID\n';
    const rows = records.map(r => {
      const date = format(r.timestamp, 'MM/dd_HH:mm:ss');
      return `${date},${r.last5}`;
    }).join('\n');
    return header + rows;
  };

  const downloadCSV = () => {
    const csv = generateCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scan_${settings.location}_${format(new Date(), 'yyyyMMddHHmm')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadBin = () => {
    const dataArray = records.map(r => parseInt(r.last5, 10));
    const uint16 = new Uint16Array(dataArray);
    const blob = new Blob([uint16], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ids_${settings.location}_${format(new Date(), 'yyyyMMddHHmm')}.bin`;
    link.click();
    URL.revokeObjectURL(url);
  };

  
  const clearHistory = () => {
    if (window.confirm('履歴を消去します')) {
      setRecords([]);
    }
  };

  const deleteRecord = (id: string) => {
    if (window.confirm('この記録を削除しますか？')) {
      setRecords(prev => prev.filter(r => r.id !== id)); //要再検討
    }
  };

  //本体の関数たちここまで







  //下記UI部はすべてgemini生成です．
  //本当にあり得ないくらいぐしゃぐしゃで申し訳ないです。


  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">

      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-gray-500" />
          <span className="font-medium text-gray-700">スキャン場所:</span>
          {settings.location ? (
            <span className="text-blue-600 font-bold">{settings.location}</span>
          ) : (
            <span className="text-red-500 font-bold">未設定（設定から選択してください）</span>
          )}
        </div>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
          title="スキャン場所の設定"
        >
          <Settings size={20} />
        </button>
      </div>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1 w-full">
            <input
              type="text"
              maxLength={18} //数字に意味はありません
              placeholder="数字5桁を入力"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualBarcode.length != 0) {
                  if(manualBarcode.length === 5 || manualBarcode.length === 10) {
                    handleScan(manualBarcode);
                    setManualBarcode('');
                  } else {
                    setManualBarcode('');
                    triggerError('スキャン失敗');
                  }
                }

              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={() => {
              if (manualBarcode.length === 5 || manualBarcode.length === 10) {
                handleScan(manualBarcode);
                setManualBarcode('');
              } else {
                alert('5桁の数字を入力');
              }
            }}
            disabled={manualBarcode.length < 5}
            className="w-full sm:w-auto px-6 py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock size={16} />
              <span>{records.length}件スキャン済</span>
            </div>
            <div className="h-4 w-px bg-gray-300 hidden sm:block"></div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={clearHistory}
              disabled={records.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={16} />
              Clear
            </button>
            <button
              onClick={downloadCSV}
              disabled={records.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Export CSV
            </button>
            <button
              onClick={downloadBin}
              disabled={records.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Export Binary
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-left text-sm border-separate border-spacing-0">
              <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">Timestamp</th>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">Barcode</th>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">ID</th>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">Location</th>
                  <th className="px-6 py-3 font-medium text-right border-b border-gray-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      No scans here.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr 
                      key={record.id} 
                      className={cn(
                        "hover:bg-gray-50 transition-colors",
                        lastScannedId === record.id && "animate-highlight-blue"
                      )}
                    >
                      <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                        {format(record.timestamp, 'MM/dd HH:mm:ss')}
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-900">
                        {record.barcode}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {record.last5}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {record.location}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteRecord(record.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete record"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {scanError && (
        <div className="fixed inset-0 flex items-center justify-center z-[100] pointer-events-none">
          <div className="bg-red-600 text-white px-8 py-4 rounded-xl shadow-2xl text-xl font-bold animate-pulse">
            {scanError}
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold">設定</h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
              >
                <XCircle size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <MapPin size={16} className="text-gray-400" />
                  スキャン場所
                </label>
                <select
                  value={settings.location}
                  onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                >
                  <option value="" disabled>場所を選択してください</option>
                  {locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">ファイル名になります</p>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
