import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Download, MapPin, Settings, Trash2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from './lib/utils';

interface ScanRecord {
  id: string;
  timestamp: number;
  barcode: string;
  last5: string;
  location: string;
}

const LOCATIONS = ['2棟2階', '第一体育館前', '本部横'] as const;
const STORAGE_KEYS = {
  records: 'scanRecords',
  location: 'settings.location',
} as const;
const SCANNER_RESET_MS = 100;
const SCANNER_LENGTH = 10;
const ERROR_DISPLAY_MS = 300;
const MANUAL_LENGTHS = new Set([5, 10]);

const DIGITS_ONLY = /^\d+$/;
const TOOLBAR_BUTTON_CLASS =
  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function keepDigits(input: string): string {
  return input.replace(/\D/g, '');
}

function isDigitsWithLength(value: string, length: number): boolean {
  return value.length === length && DIGITS_ONLY.test(value);
}

function isManualBarcode(value: string): boolean {
  return MANUAL_LENGTHS.has(value.length) && DIGITS_ONLY.test(value);
}

export default function App() {
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);

  const manualInputRef = useRef<HTMLInputElement>(null);
  const scannerBufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const errorTimerRef = useRef<number | undefined>(undefined);
  const warningTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const savedRecords = localStorage.getItem(STORAGE_KEYS.records);
    if (savedRecords) {
      try {
        const parsed = JSON.parse(savedRecords) as ScanRecord[];
        if (Array.isArray(parsed)) {
          setRecords(parsed);
        }
      } catch (error) {
        console.error('Failed to parse records:', error);
      }
    }

    const savedLocation = localStorage.getItem(STORAGE_KEYS.location);
    if (savedLocation) {
      setLocation(savedLocation);
      return;
    }

    const legacySettings = localStorage.getItem('settings');
    if (legacySettings) {
      try {
        const parsed = JSON.parse(legacySettings) as { location?: string };
        if (typeof parsed.location === 'string') {
          setLocation(parsed.location);
        }
      } catch (error) {
        console.error('Failed to parse legacy settings:', error);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.location, location);
    localStorage.setItem('settings', JSON.stringify({ location }));
  }, [location]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current !== undefined) {
        window.clearTimeout(errorTimerRef.current);
      }
      if (warningTimerRef.current !== undefined) {
        window.clearTimeout(warningTimerRef.current);
      }
    };
  }, []);

  const triggerError = useCallback((message: string) => {
    setScanError(message);

    if (errorTimerRef.current !== undefined) {
      window.clearTimeout(errorTimerRef.current);
    }

    errorTimerRef.current = window.setTimeout(() => {
      setScanError(null);
      errorTimerRef.current = undefined;
    }, ERROR_DISPLAY_MS);
  }, []);

  const triggerWarning = useCallback((message: string) => {
    setScanWarning(message);

    if (warningTimerRef.current !== undefined) {
      window.clearTimeout(warningTimerRef.current);
    }

    warningTimerRef.current = window.setTimeout(() => {
      setScanWarning(null);
      warningTimerRef.current = undefined;
    }, 3000);
  }, []);

  const focusManualInput = useCallback(() => {
    window.setTimeout(() => {
      manualInputRef.current?.focus();
    }, 0);
  }, []);

  const handleScan = useCallback(
    async (barcode: string) => {
      if (!location) {
        setIsSettingsOpen(true);
        return;
      }

      const timestamp = Date.now();
      const last5 = barcode.slice(-5);
      const id = `${timestamp}_${last5}`;

      const newRecord: ScanRecord = {
        id,
        timestamp,
        barcode,
        last5,
        location,
      };

      setRecords((prev) => [newRecord, ...prev]);
      setLastScannedId(id);

      try {
        await window.ipcRenderer.invoke('save-scan', { last5, location });
      } catch (error) {
        console.error('Failed to send scan to main process:', error);
      }
    },
    [location]
  );

  const submitManualBarcode = useCallback(() => {
    if (!manualBarcode) {
      return;
    }

    if (!isManualBarcode(manualBarcode)) {
      setManualBarcode('');
      triggerError('スキャン失敗');
      return;
    }

    void handleScan(manualBarcode);
    setManualBarcode('');
  }, [handleScan, manualBarcode, triggerError]);

  useEffect(() => {
    if (!location) {
      return;
    }

    const checkExistingLocationData = async () => {
      try {
        const result = await window.ipcRenderer.invoke('has-scan-data', { location });
        if (result?.success && result?.hasData) {
          triggerWarning(`注意: scans に「${location}」の既存データがあります`);
        }
      } catch (error) {
        console.error('Failed to check existing scan data:', error);
      }
    };

    void checkExistingLocationData();
  }, [location, triggerWarning]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTimeRef.current > SCANNER_RESET_MS) {
        scannerBufferRef.current = '';
      }
      lastKeyTimeRef.current = now;

      if (event.key === 'Enter') {
        if (isDigitsWithLength(scannerBufferRef.current, SCANNER_LENGTH)) {
          void handleScan(scannerBufferRef.current);
        } else if (scannerBufferRef.current.length > 0) {
          triggerError('スキャン失敗');
        }

        scannerBufferRef.current = '';
        return;
      }

      if (/^\d$/.test(event.key)) {
        scannerBufferRef.current += event.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleScan, triggerError]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadCsv = useCallback(() => {
    const header = 'Timestamp,ID\n';
    const rows = records
      .map((record) => `${format(record.timestamp, 'MM/dd_HH:mm:ss')},${record.last5}`)
      .join('\n');
    const csv = `${header}${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const filename = `scan_${location || 'unknown'}_${format(new Date(), 'yyyyMMddHHmm')}.csv`;
    downloadBlob(blob, filename);
  }, [downloadBlob, location, records]);

  const downloadBinary = useCallback(() => {
    const values = records.map((record) => Number.parseInt(record.last5, 10));
    const blob = new Blob([new Uint16Array(values)], { type: 'application/octet-stream' });
    const filename = `ids_${location || 'unknown'}_${format(new Date(), 'yyyyMMddHHmm')}.bin`;
    downloadBlob(blob, filename);
  }, [downloadBlob, location, records]);

  const clearHistory = useCallback(async () => {
    if (window.confirm('履歴を消去します')) {
      scannerBufferRef.current = '';
      lastKeyTimeRef.current = 0;
      setManualBarcode('');
      setRecords([]);
      setLastScannedId(null);
      setScanWarning(null);
      focusManualInput();

      try {
        const result = await window.ipcRenderer.invoke('clear-all-scans');
        if (!result?.success) {
          triggerError('履歴ファイルの削除に失敗しました');
        }
      } catch (error) {
        console.error('Failed to clear scan files:', error);
        triggerError('履歴ファイルの削除に失敗しました');
      }
    }
  }, [focusManualInput, triggerError]);

  const deleteRecord = useCallback(async (record: ScanRecord) => {
    if (window.confirm('この記録を削除しますか？')) {
      setRecords((prev) => prev.filter((current) => current.id !== record.id));
      setLastScannedId((prev) => (prev === record.id ? null : prev));
      focusManualInput();

      try {
        const result = await window.ipcRenderer.invoke('delete-scan-value', {
          location: record.location,
          last5: record.last5,
        });
        if (!result?.success) {
          triggerError('バイナリ同期に失敗しました');
        }
      } catch (error) {
        console.error('Failed to delete binary scan value:', error);
        triggerError('バイナリ同期に失敗しました');
      }
    }
  }, [focusManualInput, triggerError]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-gray-500" />
          <span className="font-medium text-gray-700">スキャン場所:</span>
          {location ? (
            <span className="text-blue-600 font-bold">{location}</span>
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
              ref={manualInputRef}
              type="text"
              maxLength={18}
              placeholder="数字を入力（判定は送信時）"
              value={manualBarcode}
              onChange={(event) => setManualBarcode(keepDigits(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitManualBarcode();
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <button
            onClick={submitManualBarcode}
            disabled={manualBarcode.length < 5}
            className="w-full sm:w-auto px-6 py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            送信
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
              className={cn(TOOLBAR_BUTTON_CLASS, 'text-red-600 bg-red-50 hover:bg-red-100')}
            >
              <Trash2 size={16} />
              履歴削除
            </button>
            <button
              onClick={downloadCsv}
              disabled={records.length === 0}
              className={cn(TOOLBAR_BUTTON_CLASS, 'text-gray-700 bg-gray-100 hover:bg-gray-200')}
            >
              <Download size={16} />
              CSV出力
            </button>
            <button
              onClick={downloadBinary}
              disabled={records.length === 0}
              className={cn(TOOLBAR_BUTTON_CLASS, 'text-gray-700 bg-gray-100 hover:bg-gray-200')}
            >
              <Download size={16} />
              BIN出力
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-left text-sm border-separate border-spacing-0">
              <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">時刻</th>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">バーコード</th>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">ID下5桁</th>
                  <th className="px-6 py-3 font-medium border-b border-gray-200">場所</th>
                  <th className="px-6 py-3 font-medium text-right border-b border-gray-200">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      スキャン履歴はありません。
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr
                      key={record.id}
                      className={cn(
                        'hover:bg-gray-50 transition-colors',
                        lastScannedId === record.id && 'animate-highlight-blue'
                      )}
                    >
                      <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                        {format(record.timestamp, 'MM/dd HH:mm:ss')}
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-900">{record.barcode}</td>
                      <td className="px-6 py-4 text-gray-600">{record.last5}</td>
                      <td className="px-6 py-4 text-gray-600">{record.location}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            void deleteRecord(record);
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="この記録を削除"
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

      {scanWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
          <div className="bg-amber-500 text-white px-6 py-3 rounded-xl shadow-xl text-sm font-semibold">
            {scanWarning}
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
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                >
                  <option value="" disabled>
                    場所を選択してください
                  </option>
                  {LOCATIONS.map((currentLocation) => (
                    <option key={currentLocation} value={currentLocation}>
                      {currentLocation}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">保存ファイル名に使用されます</p>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                完了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
