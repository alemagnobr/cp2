import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Download, 
  RefreshCw, 
  LogIn, 
  LogOut, 
  Cloud, 
  CloudOff, 
  Users, 
  ChevronDown, 
  PlusCircle, 
  Trash2, 
  Globe, 
  TrendingUp, 
  Calendar, 
  AlertCircle,
  TrendingDown,
  ShieldAlert,
  Shield,
  ChevronUp,
  Sliders,
  DollarSign,
  Maximize2,
  Trophy,
  Sparkles,
  Eraser
} from 'lucide-react';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, collection } from 'firebase/firestore';
import { GoogleGenAI, Type } from "@google/genai";

// --- Tipos e Enums de Erro para Firebase ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type MonthData = {
  resultado: string;
  ddMax: string;
  operacoes?: string;
};

type YearData = {
  year: number;
  months: MonthData[]; // Array de 12 (Jan - Dez)
};

interface Asset {
  id: string; // Ex: "EUR-USD_D1"
  pair: string; // Ex: "EUR/USD"
  timeframe: string; // Ex: "D1"
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// --- Helpers de Cálculo e Formatação ---
const parseNum = (val: string): number | null => {
  if (!val || val.trim() === '' || val.trim() === '-') return null;
  const parsed = parseFloat(val.replace(',', '.'));
  return isNaN(parsed) ? null : parsed;
};

const formatNum = (val: number | null): string => {
  if (val === null) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(val);
};

const calcRX = (resStr: string, ddStr: string, stopLoss: number): number | null => {
  const res = parseNum(resStr);
  const dd = parseNum(ddStr);

  if (dd !== null && dd <= -stopLoss) {
    return -stopLoss;
  }
  if (res !== null) return res;
  if (dd !== null) return res || 0; 
  return null;
};

// Cores premium para tabelas e inputs
const getCellColorClass = (val: number | null, isDdRow: boolean = false) => {
  if (val === null) return 'bg-white text-slate-400';
  if (isDdRow) {
    return 'bg-rose-50/90 text-rose-700 border-rose-200/60 font-semibold';
  }
  if (val > 0) return 'bg-emerald-50/90 text-emerald-700 border-emerald-200/60 font-semibold';
  if (val < 0) return 'bg-rose-50/90 text-rose-700 border-rose-200/60 font-semibold';
  return 'bg-slate-50 text-slate-500 border-slate-200/40';
};

interface StreakSegment {
  startMonth: number;
  endMonth: number;
  monthsCount: number;
  values: number[];
}

const getPositiveStreaks = (months: MonthData[], threshold: number): StreakSegment[] => {
  const streaks: StreakSegment[] = [];
  let currentStreak: StreakSegment | null = null;

  months.forEach((m, idx) => {
    const res = parseNum(m.resultado);
    if (res !== null && res >= threshold) {
      if (!currentStreak) {
        currentStreak = {
          startMonth: idx,
          endMonth: idx,
          monthsCount: 1,
          values: [res]
        };
      } else {
        currentStreak.endMonth = idx;
        currentStreak.monthsCount++;
        currentStreak.values.push(res);
      }
    } else {
      if (currentStreak) {
        streaks.push(currentStreak);
        currentStreak = null;
      }
    }
  });

  if (currentStreak) {
    streaks.push(currentStreak);
  }

  return streaks;
};

const getNegativeStreaks = (months: MonthData[]): StreakSegment[] => {
  const streaks: StreakSegment[] = [];
  let currentStreak: StreakSegment | null = null;

  months.forEach((m, idx) => {
    const res = parseNum(m.resultado);
    if (res !== null && res < 0) {
      if (!currentStreak) {
        currentStreak = {
          startMonth: idx,
          endMonth: idx,
          monthsCount: 1,
          values: [res]
        };
      } else {
        currentStreak.endMonth = idx;
        currentStreak.monthsCount++;
        currentStreak.values.push(res);
      }
    } else {
      if (currentStreak) {
        streaks.push(currentStreak);
        currentStreak = null;
      }
    }
  });

  if (currentStreak) {
    streaks.push(currentStreak);
  }

  return streaks;
};

// Esquemas de cores premium para as regras R-X customizadas (cicla sequencialmente)
const RULE_COLORS = [
  { border: 'border-l-blue-500', text: 'text-blue-600', dot: 'bg-blue-500', bg: 'from-blue-50/20', iconBg: 'bg-blue-100/50 text-blue-600 border-blue-200/50 text-blue-700' },
  { border: 'border-l-indigo-500', text: 'text-indigo-600', dot: 'bg-indigo-500', bg: 'from-indigo-50/20', iconBg: 'bg-indigo-100/50 text-indigo-600 border-indigo-200/50 text-indigo-700' },
  { border: 'border-l-violet-500', text: 'text-violet-600', dot: 'bg-violet-500', bg: 'from-violet-50/20', iconBg: 'bg-violet-100/50 text-violet-600 border-violet-200/50 text-violet-700' },
  { border: 'border-l-purple-500', text: 'text-purple-600', dot: 'bg-purple-500', bg: 'from-purple-50/20', iconBg: 'bg-purple-100/50 text-purple-600 border-purple-200/50 text-purple-700' },
  { border: 'border-l-fuchsia-500', text: 'text-fuchsia-600', dot: 'bg-fuchsia-500', bg: 'from-fuchsia-50/20', iconBg: 'bg-fuchsia-100/50 text-fuchsia-600 border-fuchsia-200/50 text-fuchsia-700' },
  { border: 'border-l-pink-500', text: 'text-pink-600', dot: 'bg-pink-500', bg: 'from-pink-50/20', iconBg: 'bg-pink-100/50 text-pink-600 border-pink-200/50 text-pink-700' },
];

const getInitialDefaultData = (): YearData[] => {
  const initialYears = Array.from({ length: 12 }, (_, i) => 2026 - i);
  return initialYears.map(year => ({
    year,
    months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' }))
  }));
};

// --- Componente Principal ---
export default function App() {
  const [data, setData] = useState<YearData[]>([]);
  const [spread, setSpread] = useState<string>('1.0');
  const [posStreakThreshold, setPosStreakThreshold] = useState<string>(() => {
    return localStorage.getItem('pip-tracker-pos-streak-threshold') || '30';
  });
  const [customRules, setCustomRules] = useState<number[]>(() => {
    const saved = localStorage.getItem('pip-tracker-custom-rules');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const loaded = parsed.map(Number).filter(n => !isNaN(n) && n > 0);
          if (loaded.length === 2 && loaded.includes(50) && loaded.includes(100)) {
            const migrated = [...loaded, 150].sort((a, b) => a - b);
            localStorage.setItem('pip-tracker-custom-rules', JSON.stringify(migrated));
            return migrated;
          }
          return loaded;
        }
      } catch (e) {
        // ignore
      }
    }
    return [50, 100, 150];
  });
  const [newRuleVal, setNewRuleVal] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  // Controle de colapso de cada ano
  const [collapsedYears, setCollapsedYears] = useState<Record<number, boolean>>({});

  // Estados para Ativos / Paridades
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('EUR-USD_D1');

  // Modais
  const [showNewAssetModal, setShowNewAssetModal] = useState(false);
  const [newPair, setNewPair] = useState('');
  const [newTimeframe, setNewTimeframe] = useState('');

  const [showNewYearModal, setShowNewYearModal] = useState(false);
  const [newYearValue, setNewYearValue] = useState<string>(String(new Date().getFullYear()));

  // Estados da IA do Gemini
  const [showGeminiModal, setShowGeminiModal] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('pip-tracker-gemini-api-key') || '';
  });

  const saveTimeoutRef = useRef<any>(null);

  // Carrega ativos locais do localStorage
  const loadLocalAssets = () => {
    const savedAssets = localStorage.getItem('pip-tracker-assets');
    if (savedAssets) {
      try {
        const parsed = JSON.parse(savedAssets);
        setAssets(parsed);
        if (!parsed.some((a: Asset) => a.id === selectedAssetId)) {
          setSelectedAssetId(parsed[0]?.id || 'EUR-USD_D1');
        }
      } catch (e) {
        const defaultAssets = [{ id: 'EUR-USD_D1', pair: 'EUR/USD', timeframe: 'D1' }];
        setAssets(defaultAssets);
        setSelectedAssetId('EUR-USD_D1');
      }
    } else {
      const defaultAssets = [{ id: 'EUR-USD_D1', pair: 'EUR/USD', timeframe: 'D1' }];
      setAssets(defaultAssets);
      setSelectedAssetId('EUR-USD_D1');
      localStorage.setItem('pip-tracker-assets', JSON.stringify(defaultAssets));
    }
  };

  // Monitorar Autenticação
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        loadLocalAssets();
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // 1. Monitorar Lista de Ativos do Firestore (Se logado)
  useEffect(() => {
    let unsubscribeAssets: (() => void) | null = null;
    
    if (user) {
      unsubscribeAssets = onSnapshot(collection(db, 'shared_assets'), (collectionSnap) => {
        const loadedAssets: Asset[] = [];
        collectionSnap.forEach((docSnap) => {
          const d = docSnap.data();
          loadedAssets.push({
            id: docSnap.id,
            pair: d.pair || '',
            timeframe: d.timeframe || '',
          });
        });

        if (loadedAssets.length === 0) {
          // Se a coleção estiver vazia no Firestore, cria o ativo EUR/USD D1 padrão com o histórico completo
          const defaultData = getInitialDefaultData();
          setDoc(doc(db, 'shared_assets', 'EUR-USD_D1'), {
            id: 'EUR-USD_D1',
            pair: 'EUR/USD',
            timeframe: 'D1',
            data: defaultData
          });
        } else {
          setAssets(loadedAssets);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'shared_assets');
      });
    } else {
      loadLocalAssets();
    }

    return () => {
      if (unsubscribeAssets) unsubscribeAssets();
    };
  }, [user]);

  // 2. Monitorar Dados do Ativo Selecionado (Tempo Real)
  useEffect(() => {
    let unsubscribeData: (() => void) | null = null;
    setIsLoaded(false);

    if (user) {
      const docRef = doc(db, 'shared_assets', selectedAssetId);
      unsubscribeData = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const cloudData = docSnap.data().data as YearData[];
          const cloudSpread = docSnap.data().spread !== undefined ? String(docSnap.data().spread) : '1.0';
          setData(cloudData);
          setSpread(cloudSpread);
          
          const cloudRules = docSnap.data().customRules as number[] | undefined;
          if (cloudRules && Array.isArray(cloudRules)) {
            let finalRules = cloudRules;
            if (cloudRules.length === 2 && cloudRules.includes(50) && cloudRules.includes(100)) {
              finalRules = [...cloudRules, 150].sort((a, b) => a - b);
            }
            setCustomRules(finalRules);
            localStorage.setItem('pip-tracker-custom-rules', JSON.stringify(finalRules));
          }

          localStorage.setItem(`pip-tracker-data-${selectedAssetId}`, JSON.stringify(cloudData));
          localStorage.setItem(`pip-tracker-spread-${selectedAssetId}`, cloudSpread);
        } else {
          // Documento não existe ainda. Se o ativo está na lista, vamos criá-lo em branco apenas com o ano atual
          const currentYear = new Date().getFullYear();
          const defaultState = [{ year: currentYear, months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' })) }];
          setData(defaultState);
          setSpread('1.0');
          setDoc(doc(db, 'shared_assets', selectedAssetId), {
            id: selectedAssetId,
            pair: assets.find(a => a.id === selectedAssetId)?.pair || selectedAssetId.split('_')[0].replace('-', '/'),
            timeframe: assets.find(a => a.id === selectedAssetId)?.timeframe || selectedAssetId.split('_')[1] || 'D1',
            data: defaultState,
            spread: 1.0
          });
        }
        setIsLoaded(true);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `shared_assets/${selectedAssetId}`);
        setIsLoaded(true);
      });
    } else {
      // Offline: ler do localStorage
      const saved = localStorage.getItem(`pip-tracker-data-${selectedAssetId}`);
      const savedSpread = localStorage.getItem(`pip-tracker-spread-${selectedAssetId}`);
      setSpread(savedSpread || '1.0');
      
      if (saved) {
        try {
          setData(JSON.parse(saved));
        } catch (e) {
          if (selectedAssetId === 'EUR-USD_D1') {
            setData(getInitialDefaultData());
          } else {
            setData([{ year: new Date().getFullYear(), months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' })) }]);
          }
        }
      } else {
        if (selectedAssetId === 'EUR-USD_D1') {
          const defaultData = getInitialDefaultData();
          setData(defaultData);
          localStorage.setItem(`pip-tracker-data-${selectedAssetId}`, JSON.stringify(defaultData));
        } else {
          const defaultData = [{ year: new Date().getFullYear(), months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' })) }];
          setData(defaultData);
          localStorage.setItem(`pip-tracker-data-${selectedAssetId}`, JSON.stringify(defaultData));
        }
      }
      setIsLoaded(true);
    }

    return () => {
      if (unsubscribeData) unsubscribeData();
    };
  }, [selectedAssetId, user, assets]);

  const saveToFirebase = async (dataToSave: YearData[], currentSpread: string, currentRules?: number[]) => {
    if (!auth.currentUser) return;
    setSyncStatus('saving');
    const path = `shared_assets/${selectedAssetId}`;
    const rulesToSave = currentRules || customRules;
    try {
      const docRef = doc(db, 'shared_assets', selectedAssetId);
      await setDoc(docRef, {
        id: selectedAssetId,
        pair: assets.find(a => a.id === selectedAssetId)?.pair || selectedAssetId.split('_')[0].replace('-', '/'),
        timeframe: assets.find(a => a.id === selectedAssetId)?.timeframe || selectedAssetId.split('_')[1] || 'D1',
        data: dataToSave,
        spread: parseNum(currentSpread) !== null ? parseFloat(currentSpread.replace(',', '.')) : 1.0,
        customRules: rulesToSave
      });
      setSyncStatus('saved');
      setTimeout(() => setSyncStatus('idle'), 2000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
      setSyncStatus('error');
    }
  };

  const handleAddRule = (val: number) => {
    if (customRules.includes(val)) {
      alert(`A regra R-${val} já existe!`);
      return;
    }
    const updated = [...customRules, val].sort((a, b) => a - b);
    setCustomRules(updated);
    localStorage.setItem('pip-tracker-custom-rules', JSON.stringify(updated));
    setNewRuleVal('');
    if (auth.currentUser) {
      saveToFirebase(data, spread, updated);
    }
  };

  const handleDeleteRule = (rule: number) => {
    if (customRules.length <= 1) {
      alert("Você deve manter pelo menos uma regra R-X!");
      return;
    }
    const updated = customRules.filter(r => r !== rule);
    setCustomRules(updated);
    localStorage.setItem('pip-tracker-custom-rules', JSON.stringify(updated));
    if (auth.currentUser) {
      saveToFirebase(data, spread, updated);
    }
  };

  // Centraliza a alteração de dados iniciada pelo usuário na tela
  const handleDataChange = (newData: YearData[]) => {
    const sortedData = [...newData].sort((a, b) => b.year - a.year);
    setData(sortedData);
    localStorage.setItem(`pip-tracker-data-${selectedAssetId}`, JSON.stringify(sortedData));
    
    if (auth.currentUser) {
      setSyncStatus('saving');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveToFirebase(sortedData, spread, customRules);
      }, 1000); // 1s de debounce para evitar excesso de requisições ao digitar
    }
  };

  const handleSpreadChange = (newSpread: string) => {
    setSpread(newSpread);
    localStorage.setItem(`pip-tracker-spread-${selectedAssetId}`, newSpread);
    
    if (auth.currentUser) {
      setSyncStatus('saving');
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveToFirebase(data, newSpread, customRules);
      }, 1000);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Erro no login", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setData([]); // Limpa dados da tela
    } catch (error) {
      console.error("Erro no logout", error);
    }
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPair || !newTimeframe) return;

    const formattedPair = newPair.trim().toUpperCase();
    const formattedTimeframe = newTimeframe.trim().toUpperCase();
    const assetId = `${formattedPair.replace('/', '-')}_${formattedTimeframe}`;

    // Verificar se o ativo já existe
    if (assets.some(a => a.id === assetId)) {
      alert("Este ativo com este timeframe já existe!");
      return;
    }

    const newAssetObj: Asset = {
      id: assetId,
      pair: formattedPair,
      timeframe: formattedTimeframe,
    };

    const initialAssetData = [
      {
        year: new Date().getFullYear(),
        months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' }))
      }
    ];

    if (user) {
      try {
        await setDoc(doc(db, 'shared_assets', assetId), {
          id: assetId,
          pair: formattedPair,
          timeframe: formattedTimeframe,
          data: initialAssetData,
          spread: 1.0
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, `shared_assets/${assetId}`);
      }
    } else {
      const updatedAssets = [...assets, newAssetObj];
      setAssets(updatedAssets);
      localStorage.setItem('pip-tracker-assets', JSON.stringify(updatedAssets));
      localStorage.setItem(`pip-tracker-data-${assetId}`, JSON.stringify(initialAssetData));
      localStorage.setItem(`pip-tracker-spread-${assetId}`, '1.0');
    }

    setSelectedAssetId(assetId);
    setShowNewAssetModal(false);
    setNewPair('');
    setNewTimeframe('');
  };

  const handleAddCustomYear = (e: React.FormEvent) => {
    e.preventDefault();
    const yearNum = parseInt(newYearValue);
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
      alert("Por favor, digite um ano válido entre 1900 e 2100.");
      return;
    }

    if (data.some(d => d.year === yearNum)) {
      alert(`O ano ${yearNum} já está registrado neste ativo!`);
      return;
    }

    const newYearObj: YearData = {
      year: yearNum,
      months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' }))
    };

    const newData = [newYearObj, ...data];
    handleDataChange(newData);
    setShowNewYearModal(false);
  };

  const handleDeleteYear = (yearNum: number) => {
    if (window.confirm(`Tem certeza que deseja EXCLUIR permanentemente o ano de ${yearNum}? Todos os meses e métricas deste ano serão apagados.`)) {
      const newData = data.filter(d => d.year !== yearNum);
      handleDataChange(newData);
    }
  };

  const handleClearYearData = (yearNum: number) => {
    if (window.confirm(`Tem certeza que deseja LIMPAR todos os dados do ano de ${yearNum}? Os valores de resultado, ddMax e operações de todos os meses serão redefinidos para vazio.`)) {
      const newData = data.map(d => {
        if (d.year === yearNum) {
          return {
            ...d,
            months: Array.from({ length: 12 }, () => ({ resultado: '', ddMax: '', operacoes: '' }))
          };
        }
        return d;
      });
      handleDataChange(newData);
    }
  };

  const toggleYearCollapse = (yearNum: number) => {
    setCollapsedYears(prev => {
      const currentlyCollapsed = prev[yearNum] !== false;
      return {
        ...prev,
        [yearNum]: !currentlyCollapsed
      };
    });
  };

  const updateCell = (yearIndex: number, monthIndex: number, field: keyof MonthData, value: string) => {
    const newData = [...data];
    if (!newData[yearIndex].months[monthIndex]) {
      newData[yearIndex].months[monthIndex] = { resultado: '', ddMax: '', operacoes: '' };
    }
    newData[yearIndex].months[monthIndex][field] = value;
    handleDataChange(newData);
  };

  const clearData = () => {
    if (window.confirm("ATENÇÃO: Tem certeza que deseja limpar todos os dados do ativo atual? Esta alteração apagará os dados para TODOS os usuários conectados.")) {
      const defaultState = getInitialDefaultData();
      handleDataChange(defaultState);
    }
  };

  // Calcular Totais Consolidados (Gerais) de todos os anos do ativo atual
  let grandTotalResultado = 0;
  const grandTotalRX: Record<number, number> = {};
  customRules.forEach(r => {
    grandTotalRX[r] = 0;
  });
  let grandTotalOperacoes = 0;
  let hasAnyData = false;

  data.forEach(yearData => {
    yearData.months.forEach(m => {
      const res = parseNum(m.resultado);
      if (res !== null) {
        grandTotalResultado += res;
        hasAnyData = true;
      }
      customRules.forEach(r => {
        const rx = calcRX(m.resultado, m.ddMax, r);
        if (rx !== null) {
          grandTotalRX[r] = (grandTotalRX[r] || 0) + rx;
          hasAnyData = true;
        }
      });
      const ops = parseNum(m.operacoes || '');
      if (ops !== null) {
        grandTotalOperacoes += ops;
      }
    });
  });

  const spreadVal = parseNum(spread) !== null ? parseFloat(spread.replace(',', '.')) : 1.0;
  const grandTotalSpreadCost = grandTotalOperacoes * spreadVal;

  const grandNetResultado = grandTotalResultado - grandTotalSpreadCost;
  const grandNetRX: Record<number, number> = {};
  customRules.forEach(r => {
    grandNetRX[r] = (grandTotalRX[r] || 0) - grandTotalSpreadCost;
  });

  const bestGrandNet = hasAnyData ? Math.max(grandNetResultado, ...customRules.map(r => grandNetRX[r] || 0)) : null;

  // Calcular Média de Perda (Drawdown Médio Anual) para identificar o Menor Risco
  let bestRiskStrategy: string | null = null; // 'geral' ou `r-${r}`
  const avgLosses: Record<string, number> = {};
  let validYearsCount = 0;

  let sumLossGeral = 0;
  const sumLossRX: Record<number, number> = {};
  customRules.forEach(r => {
    sumLossRX[r] = 0;
  });

  data.forEach(yearData => {
    let minDD: number | null = null;
    yearData.months.forEach(m => {
      const dd = parseNum(m.ddMax);
      if (dd !== null) {
        if (minDD === null || dd < minDD) minDD = dd;
      }
    });

    if (minDD !== null) {
      validYearsCount++;
      sumLossGeral += minDD;
      customRules.forEach(r => {
        sumLossRX[r] += Math.max(minDD!, -r);
      });
    }
  });

  if (validYearsCount > 0) {
    avgLosses['geral'] = sumLossGeral / validYearsCount;
    customRules.forEach(r => {
      avgLosses[`r-${r}`] = sumLossRX[r] / validYearsCount;
    });

    // Encontrar a estratégia com a maior média de drawdown (mais próxima de 0, ou seja, menor perda)
    let maxAvg = -Infinity;
    let selectedStrategy: string | null = null;

    if (avgLosses['geral'] > maxAvg) {
      maxAvg = avgLosses['geral'];
      selectedStrategy = 'geral';
    }

    customRules.forEach(r => {
      const key = `r-${r}`;
      if (avgLosses[key] > maxAvg) {
        maxAvg = avgLosses[key];
        selectedStrategy = key;
      }
    });

    bestRiskStrategy = selectedStrategy;
  }

  const activeAsset = assets.find(a => a.id === selectedAssetId) || { pair: 'EUR/USD', timeframe: 'D1' };

  if (!isLoaded) {
    return (
      <div className="p-8 text-center flex flex-col justify-center items-center min-h-screen text-slate-500 font-medium text-lg bg-slate-50 gap-3">
        <RefreshCw size={36} className="animate-spin text-blue-600" />
        <span className="font-sans font-medium tracking-tight">Carregando dados colaborativos em tempo real...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 p-4 lg:p-6 font-sans antialiased">
      <div className="max-w-[1450px] mx-auto space-y-6">
        
        {/* --- Header da Aplicação --- */}
        <header className="bg-white border border-slate-200/80 rounded-2xl shadow-sm p-4 lg:p-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-5 transition-all">
          <div className="space-y-3.5 w-full lg:w-auto">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 text-white p-2.5 rounded-xl shadow-md shadow-blue-500/10 shrink-0">
                <Sliders size={22} />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                  <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 font-sans">
                    Terminal de Pips
                  </h1>
                  
                  {user ? (
                    <div className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100/80 font-bold shadow-2xs shrink-0 self-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <Users size={12} />
                      <span>Modo Colaborativo</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100/80 font-bold shadow-2xs shrink-0 self-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      <CloudOff size={12} />
                      <span>Modo Local</span>
                    </div>
                  )}
                </div>
                <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Mapeamento de drawdown & performance colaborativa
                </p>
              </div>
            </div>
            
            {/* Seletor de Ativos & Spread */}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Ativo:</span>
                <div className="relative">
                  <select
                    value={selectedAssetId}
                    onChange={(e) => setSelectedAssetId(e.target.value)}
                    className="appearance-none bg-slate-100 text-slate-800 font-bold pl-3.5 pr-9 py-1.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 cursor-pointer hover:bg-slate-200/60 transition-all shadow-xs"
                  >
                    {assets.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.pair} ({a.timeframe})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-2.5 text-slate-500 pointer-events-none" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Spread (pips):</span>
                <input
                  type="text"
                  value={spread}
                  onChange={(e) => handleSpreadChange(e.target.value)}
                  className="w-16 bg-slate-100 text-slate-800 font-extrabold text-center py-1.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all shadow-xs"
                  placeholder="1.0"
                />
              </div>

              <div className="flex items-center gap-2 border-l border-slate-200/60 pl-3.5">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Alvo Seq. Positiva (pips):</span>
                <input
                  type="text"
                  value={posStreakThreshold}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPosStreakThreshold(val);
                    localStorage.setItem('pip-tracker-pos-streak-threshold', val);
                  }}
                  className="w-16 bg-slate-100 text-slate-800 font-extrabold text-center py-1.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all shadow-xs"
                  placeholder="30"
                />
              </div>

              <div className="flex items-center gap-2 border-l border-slate-200/60 pl-3.5">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Regras R-X (pips):</span>
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200/60">
                  {customRules.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1.5 bg-white text-slate-800 font-extrabold text-xs px-2.5 py-0.5 rounded-lg border border-slate-200/80 shadow-3xs">
                      R-{r}
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(r)}
                        className="text-slate-400 hover:text-rose-500 transition-colors cursor-pointer font-black leading-none text-xs"
                        title={`Remover R-${r}`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const val = parseInt(newRuleVal);
                      if (!isNaN(val) && val > 0) {
                        handleAddRule(val);
                      }
                    }}
                    className="flex items-center gap-1"
                  >
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg shadow-3xs px-2 focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition-all">
                      <span className="text-xs font-black text-slate-400 select-none">R-</span>
                      <input
                        type="number"
                        value={newRuleVal}
                        onChange={(e) => setNewRuleVal(e.target.value)}
                        placeholder="30"
                        className="w-10 bg-transparent text-slate-800 font-extrabold text-center py-0.5 px-0.5 text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-[10px] font-black px-2 py-0.5 rounded-lg transition-all cursor-pointer uppercase shadow-3xs hover:shadow-2xs h-[24px] flex items-center justify-center"
                    >
                      Aplicar
                    </button>
                  </form>
                </div>
              </div>

              <button
                onClick={() => setShowNewAssetModal(true)}
                className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100/80 text-blue-600 border border-blue-200/40 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <PlusCircle size={13} /> Novo Ativo / Paridade
              </button>
            </div>
          </div>
          
          {/* Ações de Autenticação e Configurações */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
            {user ? (
               <div className="flex items-center gap-2.5 bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200/60 shadow-xs">
                 <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}`} alt="Avatar" className="w-7 h-7 rounded-full border border-slate-300" />
                 <span className="text-sm font-semibold text-slate-700 hidden sm:inline">{user.displayName || user.email}</span>
                 <button onClick={handleLogout} className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer" title="Sair do Terminal">
                   <LogOut size={16} />
                 </button>
               </div>
            ) : (
               <button 
                 onClick={handleLogin}
                 className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-all text-sm font-bold shadow-sm shadow-blue-500/10 cursor-pointer"
               >
                 <LogIn size={15} /> Entrar com Google
               </button>
            )}

            <button 
              onClick={() => {
                const maxYear = data.length > 0 ? Math.max(...data.map(d => d.year)) : new Date().getFullYear();
                setNewYearValue(String(maxYear + 1));
                setShowNewYearModal(true);
              }}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl transition-all text-sm font-bold shadow-sm shadow-emerald-500/10 cursor-pointer"
            >
              <Plus size={15} /> Registrar Ano
            </button>
            
            <button 
              onClick={() => setShowGeminiModal(true)}
              className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-3.5 py-2 rounded-xl transition-all text-sm font-bold cursor-pointer shadow-3xs"
              title="Configurar chave de API do Gemini para rodar na Github Pages"
            >
              <Sparkles size={14} className="text-purple-600 animate-pulse" />
              <span>Configurar Gemini</span>
            </button>

            <button 
              onClick={clearData}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-600 border border-slate-200/40 px-3.5 py-2 rounded-xl transition-all text-sm font-bold cursor-pointer"
              title="Apagar dados e reiniciar"
            >
              <RefreshCw size={14} /> Limpar Tudo
            </button>
          </div>
        </header>

        {/* --- Painel de KPI / Totais Gerais (Soma Geral) --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
          {/* Net Profit Card */}
          {(() => {
            const isBest = hasAnyData && bestGrandNet === grandNetResultado;
            const isLowestRisk = hasAnyData && bestRiskStrategy === 'geral';
            let borderClass = 'bg-white border-slate-200/80 border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50/20 via-white to-white';
            if (isBest) {
              borderClass = 'ring-2 ring-amber-500 border-amber-400 border-l-4 border-l-emerald-500 shadow-md shadow-amber-100/50 bg-gradient-to-br from-amber-50/10 via-white to-white';
            } else if (isLowestRisk) {
              borderClass = 'ring-2 ring-blue-500 border-blue-400 border-l-4 border-l-emerald-500 shadow-md shadow-blue-100/50 bg-gradient-to-br from-blue-50/10 via-white to-white';
            }

            return (
              <div className={`relative overflow-hidden p-5 rounded-2xl shadow-xs border flex items-center justify-between group hover:shadow-md hover:border-slate-350 transition-all ${borderClass}`}>
                <div className="space-y-1.5 flex-1 min-w-0">
                  {(isBest || isLowestRisk) && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {isBest && (
                        <span className="bg-amber-500 text-white text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs tracking-wider shrink-0">
                          <Trophy size={10} className="fill-current shrink-0 text-amber-100" /> Melhor Resultado
                        </span>
                      )}
                      {isLowestRisk && (
                        <span className="bg-blue-600 text-white text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs tracking-wider shrink-0">
                          <Shield size={10} className="shrink-0 text-blue-100" /> Menor Risco
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">Net Profit Geral ({activeAsset.pair})</span>
                  </div>
                  <h2 className={`text-2xl lg:text-3xl font-black tracking-tight font-sans ${grandNetResultado >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {hasAnyData ? (grandNetResultado >= 0 ? '+' : '') + formatNum(grandNetResultado) : '0'} <span className="text-xs font-bold text-slate-400 font-mono">pips</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Bruto: <span className="font-semibold text-slate-600">{formatNum(grandTotalResultado)}</span> | Custo Spread: <span className="font-semibold text-rose-500">-{formatNum(grandTotalSpreadCost)}</span> <span className="text-slate-300">|</span> <span className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded font-mono text-[10px] font-bold">{grandTotalOperacoes} ops</span>
                    {validYearsCount > 0 && (
                      <>
                        <span className="text-slate-300"> | </span>
                        <span className="inline-flex items-center gap-0.5">DD Médio: <span className="font-bold text-rose-600 font-mono">{formatNum(avgLosses['geral'])} pips</span></span>
                      </>
                    )}
                  </p>
                </div>
                <div className={`p-3.5 rounded-xl ${grandNetResultado >= 0 ? 'bg-emerald-100/50 text-emerald-600' : 'bg-rose-100/50 text-rose-600'} transition-all shrink-0 ml-3`}>
                  {grandNetResultado >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
                </div>
              </div>
            );
          })()}

          {/* Dynamic Custom Rules Cards */}
          {customRules.map((r, rIdx) => {
            const grandTotalRXVal = grandTotalRX[r] || 0;
            const grandNetRXVal = grandNetRX[r] || 0;
            const isBest = hasAnyData && bestGrandNet === grandNetRXVal;
            const isLowestRisk = hasAnyData && bestRiskStrategy === `r-${r}`;
            const colorScheme = RULE_COLORS[rIdx % RULE_COLORS.length];

            let borderClass = `bg-white border-slate-200/80 border-l-4 ${colorScheme.border} bg-gradient-to-br ${colorScheme.bg} via-white to-white`;
            if (isBest) {
              borderClass = `ring-2 ring-amber-500 border-amber-400 border-l-4 ${colorScheme.border} shadow-md shadow-amber-100/50 bg-gradient-to-br from-amber-50/10 via-white to-white`;
            } else if (isLowestRisk) {
              borderClass = `ring-2 ring-blue-500 border-blue-400 border-l-4 ${colorScheme.border} shadow-md shadow-blue-100/50 bg-gradient-to-br from-blue-50/10 via-white to-white`;
            }

            return (
              <div 
                key={`grand-card-r-${r}`}
                className={`relative overflow-hidden p-5 rounded-2xl shadow-xs border flex items-center justify-between group hover:shadow-md hover:border-slate-350 transition-all ${borderClass}`}
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  {(isBest || isLowestRisk) && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {isBest && (
                        <span className="bg-amber-500 text-white text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs tracking-wider shrink-0">
                          <Trophy size={10} className="fill-current shrink-0 text-amber-100" /> Melhor Resultado
                        </span>
                      )}
                      {isLowestRisk && (
                        <span className="bg-blue-600 text-white text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs tracking-wider shrink-0">
                          <Shield size={10} className="shrink-0 text-blue-100" /> Menor Risco
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${colorScheme.dot}`}></span>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 truncate">Soma R-{r} Total</span>
                  </div>
                  <h2 className={`text-2xl lg:text-3xl font-black tracking-tight font-sans ${grandNetRXVal >= 0 ? colorScheme.text : 'text-rose-600'}`}>
                    {hasAnyData ? (grandNetRXVal >= 0 ? '+' : '') + formatNum(grandNetRXVal) : '0'} <span className="text-xs font-bold text-slate-400 font-mono">pips</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Bruto: <span className="font-semibold text-slate-600">{formatNum(grandTotalRXVal)}</span> | Custo Spread: <span className="font-semibold text-rose-500">-{formatNum(grandTotalSpreadCost)}</span>
                    {validYearsCount > 0 && (
                      <>
                        <span className="text-slate-300"> | </span>
                        <span className="inline-flex items-center gap-0.5">DD Médio: <span className="font-bold text-rose-600 font-mono">{formatNum(avgLosses[`r-${r}`])} pips</span></span>
                      </>
                    )}
                  </p>
                </div>
                <div className={`p-3.5 rounded-xl ${colorScheme.iconBg} shrink-0 ml-3`}>
                  <Sliders size={24} />
                </div>
              </div>
            );
          })}
        </div>

        {/* --- Tabela Principal: Modernizada por Ano --- */}
        <main className="space-y-6">
          {data.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center flex flex-col items-center justify-center gap-3">
              <Calendar size={40} className="text-slate-300" />
              <h3 className="text-lg font-bold text-slate-700">Nenhum ano registrado para {activeAsset.pair}</h3>
              <p className="text-slate-400 text-sm max-w-sm">
                Adicione um ano à planilha colaborativa usando o botão no canto superior direito para começar a mapear as métricas de pips.
              </p>
              <button
                onClick={() => {
                  setNewYearValue(String(new Date().getFullYear()));
                  setShowNewYearModal(true);
                }}
                className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-500/10 cursor-pointer"
              >
                Adicionar Ano Inicial
              </button>
            </div>
          ) : (
            data.map((yearData, yearIndex) => {
              // Calcular Totais e Métricas Específicas do Ano
              let totalRes = 0;
              let hasRes = false;
              let minDD: number | null = null;
              const totalRXYearly: Record<number, number> = {};
              const hasRXYearly: Record<number, boolean> = {};
              customRules.forEach(r => {
                totalRXYearly[r] = 0;
                hasRXYearly[r] = false;
              });
              let totalOperacoes = 0;

              // Adicionais para deixar a UI com cara de terminal financeiro:
              let positiveMonths = 0;
              let totalMonthsWithData = 0;

              yearData.months.forEach(m => {
                const res = parseNum(m.resultado);
                if (res !== null) {
                  totalRes += res;
                  hasRes = true;
                  totalMonthsWithData++;
                  if (res > 0) positiveMonths++;
                }

                const dd = parseNum(m.ddMax);
                if (dd !== null) {
                  if (minDD === null || dd < minDD) minDD = dd;
                }

                customRules.forEach(r => {
                  const rxValue = calcRX(m.resultado, m.ddMax, r);
                  if (rxValue !== null) {
                    totalRXYearly[r] = (totalRXYearly[r] || 0) + rxValue;
                    hasRXYearly[r] = true;
                  }
                });

                const ops = parseNum(m.operacoes || '');
                if (ops !== null) {
                  totalOperacoes += ops;
                }
              });

              const totalSpreadCost = totalOperacoes * spreadVal;
              const netResAfterSpread = totalRes - totalSpreadCost;

              const netRXYearlyAfterSpread: Record<number, number> = {};
              customRules.forEach(r => {
                netRXYearlyAfterSpread[r] = (totalRXYearly[r] || 0) - totalSpreadCost;
              });

              const yearlyValues = [
                hasRes ? netResAfterSpread : null,
                ...customRules.map(r => hasRXYearly[r] ? netRXYearlyAfterSpread[r] : null)
              ].filter((v): v is number => v !== null);

              const bestYearlyNet = yearlyValues.length > 0 ? Math.max(...yearlyValues) : null;

              const isBestNetRes = hasRes && bestYearlyNet !== null && netResAfterSpread === bestYearlyNet;
              const isBestRX: Record<number, boolean> = {};
              customRules.forEach(r => {
                isBestRX[r] = hasRXYearly[r] && bestYearlyNet !== null && netRXYearlyAfterSpread[r] === bestYearlyNet;
              });

              const isCollapsed = collapsedYears[yearData.year] !== false;
              const winRate = totalMonthsWithData > 0 ? (positiveMonths / totalMonthsWithData) * 100 : 0;

              const thresholdVal = parseFloat(posStreakThreshold.replace(',', '.')) || 30.0;
              const posStreaks = getPositiveStreaks(yearData.months, thresholdVal);
              const negStreaks = getNegativeStreaks(yearData.months);

              return (
                <div 
                  key={yearData.year} 
                  className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden transition-all hover:shadow-md hover:border-slate-350"
                >
                  {/* Cabeçalho do Ano com Mini-Estatísticas */}
                  <div 
                    className="p-4 bg-slate-900 border-b border-slate-950 flex flex-wrap justify-between items-center gap-4 cursor-pointer select-none text-white hover:bg-slate-850 transition-colors"
                    onClick={() => toggleYearCollapse(yearData.year)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-white text-slate-900 font-extrabold text-sm px-4 py-1.5 rounded-xl font-mono tracking-tight shadow-md hover:scale-[1.02] transition-transform shrink-0">
                        {yearData.year}
                      </div>
                      
                      {/* Mini Estatísticas para a visualização resumida */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs font-bold text-slate-300">
                        <div className="hidden sm:block border-l border-slate-800 pl-4">
                          <span className="text-slate-400">Net Result: </span>
                          <span className={`font-black font-mono text-sm inline-flex items-center gap-1 ${
                            isBestNetRes 
                              ? 'text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/25 shadow-2xs' 
                              : (netResAfterSpread >= 0 ? 'text-emerald-400' : 'text-rose-400')
                          }`}>
                            {isBestNetRes && <Trophy size={11} className="fill-current shrink-0" />}
                            {hasRes ? (netResAfterSpread >= 0 ? '+' : '') + formatNum(netResAfterSpread) : '—'}
                          </span>
                        </div>

                        {customRules.map(r => {
                          const hasRX = hasRXYearly[r];
                          const netRXVal = netRXYearlyAfterSpread[r];
                          const isBest = isBestRX[r];
                          return (
                            <div key={`head-r-${r}`} className="hidden sm:block border-l border-slate-800 pl-4">
                              <span className="text-slate-400">Net {r}: </span>
                              <span className={`font-black font-mono text-sm inline-flex items-center gap-1 ${
                                isBest 
                                  ? 'text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/25 shadow-2xs' 
                                  : (netRXVal >= 0 ? 'text-emerald-400' : 'text-rose-400')
                              }`}>
                                {isBest && <Trophy size={11} className="fill-current shrink-0" />}
                                {hasRX ? (netRXVal >= 0 ? '+' : '') + formatNum(netRXVal) : '—'}
                              </span>
                            </div>
                          );
                        })}

                        <div className="hidden md:block border-l border-slate-800 pl-4">
                          <span className="text-slate-400">DD Max: </span>
                          <span className={`font-black font-mono text-sm ${minDD !== null && minDD < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                            {minDD !== null ? formatNum(minDD) : '—'}
                          </span>
                        </div>

                        <div className="hidden lg:block border-l border-slate-800 pl-4">
                          <span className="text-slate-400">Aproveitamento: </span>
                          <span className="text-blue-400 font-black font-mono text-sm">
                            {winRate > 0 ? `${formatNum(winRate)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {/* Botão de Limpar Dados do Ano */}
                      <button 
                        onClick={() => handleClearYearData(yearData.year)}
                        className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-xl transition-all text-xs font-bold cursor-pointer hover:scale-[1.02]"
                        title="Limpar todos os dados deste ano"
                      >
                        <Eraser size={13} />
                        <span>Limpar</span>
                      </button>

                      {/* Botão de Excluir Ano */}
                      <button 
                        onClick={() => handleDeleteYear(yearData.year)}
                        className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded-xl transition-all cursor-pointer"
                        title="Remover ano do terminal"
                      >
                        <Trash2 size={16} />
                      </button>

                      {/* Botão de Colapsar/Expandir */}
                      <button 
                        onClick={() => toggleYearCollapse(yearData.year)}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl transition-all cursor-pointer"
                      >
                        {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Corpo do Ano (Tabela Principal) */}
                  {!isCollapsed && (
                    <div className="overflow-x-auto w-full">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="bg-slate-100/80 text-slate-500 font-bold uppercase tracking-wider text-left text-xs p-3.5 min-w-[130px] border-r border-slate-200/80">Métrica</th>
                            {MONTHS.map(m => (
                              <th key={m} className="bg-slate-100/80 text-slate-600 font-extrabold text-center text-xs p-3.5 min-w-[72px] border-r border-slate-200/50">
                                {m}
                              </th>
                            ))}
                            <th className="bg-slate-150 text-slate-700 font-black text-center text-xs p-3.5 min-w-[100px] border-l border-slate-200">Total / DD Max</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 font-sans">
                          
                          {/* 1. Resultado */}
                          <tr className="bg-white hover:bg-slate-50/30 transition-colors">
                            <td className="p-3 font-semibold text-slate-700 border-r border-slate-200/80 flex items-center gap-2 bg-emerald-50/15">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"></span>
                              <span>Resultado</span>
                            </td>
                            {yearData.months.map((m, mIndex) => {
                              const val = parseNum(m.resultado);
                              return (
                                <td key={`res-${mIndex}`} className={`p-1.5 border-r border-slate-100 relative text-center`}>
                                  <div className={`rounded-xl border shadow-2xs h-9 transition-all duration-150 ${getCellColorClass(val)}`}>
                                    <input
                                      type="text"
                                      value={m.resultado}
                                      onChange={(e) => updateCell(yearIndex, mIndex, 'resultado', e.target.value)}
                                      className="w-full h-full text-center bg-transparent outline-none font-semibold font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:rounded-xl focus:bg-white text-inherit"
                                      placeholder="0"
                                    />
                                  </div>
                                </td>
                              );
                            })}
                            <td className={`p-3 text-center font-bold font-mono text-sm bg-emerald-50/10`}>
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-extrabold inline-flex items-center gap-1 shadow-sm ${
                                isBestNetRes 
                                  ? 'bg-amber-500 text-white border border-amber-600/50 shadow-amber-500/10' 
                                  : (netResAfterSpread >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/50' : 'bg-rose-50 text-rose-700 border border-rose-100/50')
                              }`}>
                                {isBestNetRes && <Trophy size={11} className="fill-white/10 shrink-0" />}
                                {hasRes ? (netResAfterSpread >= 0 ? '+' : '') + formatNum(netResAfterSpread) : '—'}
                              </span>
                            </td>
                          </tr>

                          {/* 2. R-X Dinâmicos */}
                          {customRules.map((r, rIdx) => {
                            const hasRX = hasRXYearly[r];
                            const netRXVal = netRXYearlyAfterSpread[r];
                            const isBest = isBestRX[r];
                            const colorScheme = RULE_COLORS[rIdx % RULE_COLORS.length];

                            return (
                              <tr key={`r-${r}`} className={`${rIdx % 2 === 0 ? 'bg-slate-50/20' : 'bg-slate-50/45'} hover:bg-slate-100/30 transition-colors`}>
                                <td className={`p-3 font-semibold text-slate-700 border-r border-slate-200/80 flex items-center gap-2 ${colorScheme.bg}/40`}>
                                  <span className={`w-2 h-2 rounded-full ${colorScheme.dot} shadow-sm`}></span>
                                  <span>R -{r}</span>
                                </td>
                                {yearData.months.map((m, mIndex) => {
                                  const val = calcRX(m.resultado, m.ddMax, r);
                                  return (
                                    <td key={`r-${r}-${mIndex}`} className="p-2 border-r border-slate-100 text-center">
                                      <span className={`inline-block w-full py-1 rounded-lg font-mono text-xs font-semibold ${getCellColorClass(val)}`}>
                                        {formatNum(val)}
                                      </span>
                                    </td>
                                  );
                                })}
                                <td className={`p-3 text-center font-bold font-mono text-sm ${colorScheme.bg}`}>
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-extrabold inline-flex items-center gap-1 shadow-sm ${
                                    isBest 
                                      ? 'bg-amber-500 text-white border border-amber-600/50 shadow-amber-500/10' 
                                      : (netRXVal >= 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/50' : 'bg-rose-50 text-rose-700 border border-rose-100/50')
                                  }`}>
                                    {isBest && <Trophy size={11} className="fill-white/10 shrink-0" />}
                                    {hasRX ? (netRXVal >= 0 ? '+' : '') + formatNum(netRXVal) : '—'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}

                          {/* 4. DD Max */}
                          <tr className="bg-white hover:bg-slate-50/30 transition-colors">
                            <td className="p-3 font-semibold text-slate-700 border-r border-slate-200/80 flex items-center gap-2 bg-amber-50/15">
                              <span className="w-2 h-2 rounded-full bg-amber-500 shadow-sm shadow-amber-500/20"></span>
                              <span>DD Max</span>
                            </td>
                            {yearData.months.map((m, mIndex) => {
                              const val = parseNum(m.ddMax);
                              return (
                                <td key={`dd-${mIndex}`} className={`p-1.5 border-r border-slate-100 relative text-center`}>
                                  <div className={`rounded-xl border shadow-2xs h-9 transition-all duration-150 ${getCellColorClass(val, true)}`}>
                                    <input
                                      type="text"
                                      value={m.ddMax}
                                      onChange={(e) => updateCell(yearIndex, mIndex, 'ddMax', e.target.value)}
                                      className="w-full h-full text-center bg-transparent outline-none font-semibold font-mono text-sm focus:ring-2 focus:ring-amber-500 focus:rounded-xl focus:bg-white text-inherit"
                                      placeholder="0"
                                    />
                                  </div>
                                </td>
                              );
                            })}
                            <td className="p-3 text-center font-bold font-mono text-sm bg-amber-50/10">
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-extrabold bg-amber-50 text-amber-800 border border-amber-200/40`}>
                                {minDD !== null ? formatNum(minDD) : '—'}
                              </span>
                            </td>
                          </tr>

                          {/* 5. Operações */}
                          <tr className="bg-slate-50/30 hover:bg-slate-100/30 transition-colors">
                            <td className="p-3 font-semibold text-slate-700 border-r border-slate-200/80 flex items-center gap-2 bg-slate-100/20">
                              <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400/20"></span>
                              <span>Operações</span>
                            </td>
                            {yearData.months.map((m, mIndex) => {
                              return (
                                <td key={`ops-${mIndex}`} className={`p-1.5 border-r border-slate-100 relative text-center`}>
                                  <div className="rounded-xl border border-slate-200 shadow-2xs h-9 bg-slate-50/50 focus-within:bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all duration-150">
                                    <input
                                      type="text"
                                      value={m.operacoes || ''}
                                      onChange={(e) => updateCell(yearIndex, mIndex, 'operacoes', e.target.value)}
                                      className="w-full h-full text-center bg-transparent outline-none font-semibold font-mono text-sm text-slate-700"
                                      placeholder="0"
                                    />
                                  </div>
                                </td>
                              );
                            })}
                            <td className="p-3 text-center font-bold font-mono text-sm bg-slate-100/10">
                              <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-slate-100 text-slate-700 border border-slate-200">
                                {totalOperacoes}
                              </span>
                            </td>
                          </tr>

                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Análise de Sequências Consecutivas */}
                  {!isCollapsed && (
                    <div className="bg-slate-50/40 border-t border-slate-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Sequências Positivas (Configurável) */}
                      <div className="bg-white p-4 rounded-xl border border-slate-200/70 shadow-2xs space-y-3">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                          <div className="flex items-center gap-2 text-emerald-800 font-extrabold text-xs uppercase tracking-wider">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"></span>
                            <span>Sequências Positivas (≥ {formatNum(thresholdVal)} pips)</span>
                          </div>
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-100/50 uppercase font-mono">
                            {posStreaks.length} {posStreaks.length === 1 ? 'série' : 'séries'}
                          </span>
                        </div>
                        
                        <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                          {posStreaks.length > 0 ? (
                            posStreaks.map((streak, sIdx) => (
                              <div key={`pos-streak-${sIdx}`} className="flex items-center justify-between text-xs bg-emerald-50/25 hover:bg-emerald-50/50 border border-emerald-100/30 p-2.5 rounded-xl transition-all shadow-3xs">
                                <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                                  <span className="font-bold text-emerald-700 font-mono bg-emerald-100/50 border border-emerald-100/30 px-2 py-0.5 rounded-lg text-[10px]">
                                    {streak.monthsCount} {streak.monthsCount === 1 ? 'mês' : 'meses'}
                                  </span>
                                  <span className="text-slate-600 font-medium">
                                    {MONTHS[streak.startMonth]} {streak.startMonth !== streak.endMonth ? `a ${MONTHS[streak.endMonth]}` : ''}
                                  </span>
                                </div>
                                <div className="font-mono text-xs text-emerald-600 font-extrabold flex items-center gap-1 bg-white border border-emerald-100/30 px-2 py-0.5 rounded-md shadow-3xs">
                                  <span>[</span>
                                  {streak.values.map((v, vIdx) => (
                                    <span key={vIdx} className="mr-1 last:mr-0">
                                      {v >= 0 ? '+' : ''}{formatNum(v)}
                                      {vIdx < streak.values.length - 1 ? ' |' : ''}
                                    </span>
                                  ))}
                                  <span>]</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-slate-400 text-xs italic py-2">Nenhuma sequência positiva de pips encontrada para este critério.</p>
                          )}
                        </div>
                      </div>

                      {/* Sequências Negativas */}
                      <div className="bg-white p-4 rounded-xl border border-slate-200/70 shadow-2xs space-y-3">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                          <div className="flex items-center gap-2 text-rose-800 font-extrabold text-xs uppercase tracking-wider">
                            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/20"></span>
                            <span>Sequências Negativas (&lt; 0 pips)</span>
                          </div>
                          <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded border border-rose-100/50 uppercase font-mono">
                            {negStreaks.length} {negStreaks.length === 1 ? 'série' : 'séries'}
                          </span>
                        </div>
                        
                        <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                          {negStreaks.length > 0 ? (
                            negStreaks.map((streak, sIdx) => (
                              <div key={`neg-streak-${sIdx}`} className="flex items-center justify-between text-xs bg-rose-50/25 hover:bg-rose-50/50 border border-rose-100/30 p-2.5 rounded-xl transition-all shadow-3xs">
                                <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                                  <span className="font-bold text-rose-700 font-mono bg-rose-100/50 border border-rose-100/30 px-2 py-0.5 rounded-lg text-[10px]">
                                    {streak.monthsCount} {streak.monthsCount === 1 ? 'mês' : 'meses'}
                                  </span>
                                  <span className="text-slate-600 font-medium">
                                    {MONTHS[streak.startMonth]} {streak.startMonth !== streak.endMonth ? `a ${MONTHS[streak.endMonth]}` : ''}
                                  </span>
                                </div>
                                <div className="font-mono text-xs text-rose-600 font-extrabold flex items-center gap-1 bg-white border border-rose-100/30 px-2 py-0.5 rounded-md shadow-3xs">
                                  <span>[</span>
                                  {streak.values.map((v, vIdx) => (
                                    <span key={vIdx} className="mr-1 last:mr-0">
                                      {formatNum(v)}
                                      {vIdx < streak.values.length - 1 ? ' |' : ''}
                                    </span>
                                  ))}
                                  <span>]</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-slate-400 text-xs italic py-2">Nenhuma sequência negativa de pips encontrada.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Resumo de Custos e Spread do Ano */}
                  {!isCollapsed && (
                    <div className="bg-slate-50 border-t border-slate-200 p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                        <span className="bg-blue-100/85 text-blue-800 px-2.5 py-1 rounded-lg font-bold">Custo de Spread Acumulado:</span>
                        <span className="font-mono text-slate-700 text-sm font-extrabold">-{formatNum(totalSpreadCost)} pips</span>
                        <span className="text-slate-400">({totalOperacoes} operações × {spread} pips)</span>
                      </div>
                      <div className="flex flex-wrap gap-4 w-full md:w-auto">
                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                          <span className="text-xs text-slate-400 font-bold uppercase">Net Result:</span>
                          <span className={`font-mono text-xs font-black px-1.5 py-0.5 rounded-md ${netResAfterSpread >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                            {netResAfterSpread >= 0 ? '+' : ''}{formatNum(netResAfterSpread)}
                          </span>
                        </div>
                        {customRules.map((r) => {
                          const netRXVal = netRXYearlyAfterSpread[r] || 0;
                          return (
                            <div key={`summary-r-${r}`} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                              <span className="text-xs text-slate-400 font-bold uppercase">Net R-{r}:</span>
                              <span className={`font-mono text-xs font-black px-1.5 py-0.5 rounded-md ${netRXVal >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                {netRXVal >= 0 ? '+' : ''}{formatNum(netRXVal)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </main>
      </div>

      {/* MODAL: Novo Ativo / Timeline */}
      {showNewAssetModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-5">
            <div className="flex items-center gap-2.5 text-blue-600">
              <Globe size={22} className="shrink-0" />
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Nova Paridade ou Timeline</h3>
            </div>
            
            <form onSubmit={handleCreateAsset} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Divisa / Paridade de Ativo</label>
                <input
                  type="text"
                  placeholder="Ex: GBP/USD, USD/JPY, BTC/USD"
                  value={newPair}
                  onChange={(e) => setNewPair(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none font-bold uppercase tracking-wide placeholder-slate-400"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Timeline / Timeframe</label>
                <input
                  type="text"
                  placeholder="Ex: D1, H4, H1, M15"
                  value={newTimeframe}
                  onChange={(e) => setNewTimeframe(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none font-bold uppercase tracking-wide placeholder-slate-400"
                  required
                />
              </div>

              <div className="bg-blue-50/70 p-3.5 rounded-xl border border-blue-100 flex gap-2.5 text-blue-800 text-xs leading-relaxed">
                <AlertCircle size={18} className="shrink-0 text-blue-500 mt-0.5" />
                <span>O ativo será gerado como uma nova planilha em branco com o ano atual. Em seguida, você poderá utilizar o botão de registro para importar dados de anos anteriores!</span>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewAssetModal(false)}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-500/10 cursor-pointer transition-colors"
                >
                  Gerar Ativo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Adicionar Ano */}
      {showNewYearModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 space-y-5">
            <div className="flex items-center gap-2.5 text-emerald-600">
              <Calendar size={22} className="shrink-0" />
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Mapear Novo Ano</h3>
            </div>
            
            <form onSubmit={handleAddCustomYear} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Qual ano deseja registrar?</label>
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  placeholder="Ex: 2026, 2014"
                  value={newYearValue}
                  onChange={(e) => setNewYearValue(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-center text-xl font-black focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 outline-none text-slate-800"
                  required
                />
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/60 flex gap-2.5 text-slate-600 text-xs leading-relaxed">
                <AlertCircle size={18} className="shrink-0 text-slate-400 mt-0.5" />
                <span>O novo ano será inserido e classificado de forma ordenada (do mais recente ao mais antigo) no terminal colaborativo.</span>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewYearModal(false)}
                  className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-500/10 cursor-pointer transition-colors"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Configurar Chave Gemini */}
      {showGeminiModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-5">
            <div className="flex items-center gap-2.5 text-purple-600">
              <Sparkles size={22} className="shrink-0" />
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Chave de API do Gemini</h3>
            </div>
            
            <div className="space-y-4">
              <p className="text-slate-500 text-sm leading-relaxed">
                Insira sua chave de API do Gemini abaixo para habilitar o preenchimento automático inteligente mesmo quando estiver no GitHub Pages ou offline.
              </p>
              
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Sua Gemini API Key</label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 outline-none font-mono text-slate-700"
                />
              </div>

              <div className="bg-purple-50 p-3.5 rounded-xl border border-purple-100 flex gap-2.5 text-purple-900 text-xs leading-relaxed">
                <AlertCircle size={18} className="shrink-0 text-purple-500 mt-0.5" />
                <span>Esta chave será salva apenas no armazenamento local do seu próprio navegador (localStorage). Ela nunca é enviada a nenhum outro servidor que não seja a própria API oficial da Google.</span>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setGeminiApiKey('');
                    localStorage.removeItem('pip-tracker-gemini-api-key');
                    alert("Chave de API removida do armazenamento local.");
                  }}
                  className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                >
                  Limpar Chave
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowGeminiModal(false)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 cursor-pointer transition-colors"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.setItem('pip-tracker-gemini-api-key', geminiApiKey.trim());
                      setShowGeminiModal(false);
                      alert("Chave de API do Gemini salva com sucesso!");
                    }}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-500/10 cursor-pointer transition-colors"
                  >
                    Salvar Chave
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
