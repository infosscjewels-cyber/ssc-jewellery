import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Truck, X, Trash2, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import { shippingService } from '../../services/shippingService';
import shippingIllustration from '../../assets/shipping.svg';

const STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
    'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
    'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
    'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
    'Ladakh', 'Lakshadweep', 'Puducherry'
];


const emptyZone = () => ({
    id: `zone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    states: [],
    options: []
});

const emptyOption = () => ({
    id: `opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    rate: '',
    conditionType: 'price',
    min: '',
    max: ''
});

const toNullableNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const validateZoneDraft = (zone = null) => {
    if (!zone?.name?.trim()) return 'Zone name is required.';
    if (!Array.isArray(zone.states) || zone.states.length === 0) return 'Select at least one state for this zone.';
    if (!Array.isArray(zone.options) || zone.options.length === 0) return 'Add at least one shipping option.';

    const grouped = new Map();
    for (const option of zone.options) {
        if (!String(option?.name || '').trim()) return 'Each shipping option needs a name.';
        const rate = Number(option?.rate);
        if (!Number.isFinite(rate) || rate < 0) return 'Shipping rate must be a non-negative number.';
        const min = toNullableNumber(option?.min);
        const max = toNullableNumber(option?.max);
        if ((option?.min ?? '') !== '' && min === null) return 'Minimum value must be a valid number.';
        if ((option?.max ?? '') !== '' && max === null) return 'Maximum value must be a valid number.';
        if (min !== null && min < 0) return 'Minimum value cannot be negative.';
        if (max !== null && max < 0) return 'Maximum value cannot be negative.';
        if (min !== null && max !== null && min > max) return 'Minimum value cannot be greater than maximum.';

        const key = option?.conditionType || 'price';
        const start = min === null ? Number.NEGATIVE_INFINITY : min;
        const end = max === null ? Number.POSITIVE_INFINITY : max;
        const entries = grouped.get(key) || [];
        entries.push({ start, end });
        grouped.set(key, entries);
    }

    for (const [conditionType, entries] of grouped.entries()) {
        const sorted = [...entries].sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i].start <= sorted[i - 1].end) {
                return `Overlapping ${conditionType} ranges are not allowed in the same zone.`;
            }
        }
    }

    return '';
};

export default function ShippingSettings() {
    const [zones, setZones] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState('list');
    const [draftZone, setDraftZone] = useState(null);
    const [showStatePicker, setShowStatePicker] = useState(false);
    const [optionModalOpen, setOptionModalOpen] = useState(false);
    const [editingOptionId, setEditingOptionId] = useState(null);
    const [optionDraft, setOptionDraft] = useState(emptyOption());
    const [formError, setFormError] = useState('');

    const loadZones = async () => {
        setIsLoading(true);
        try {
            const data = await shippingService.getAdminZones();
            setZones(data.zones || []);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadZones();
    }, []);

    const handleCreateZone = () => {
        const zone = emptyZone();
        setDraftZone(zone);
        setView('edit');
        setShowStatePicker(false);
        setFormError('');
    };

    const handleEditZone = (zone) => {
        setDraftZone(JSON.parse(JSON.stringify(zone)));
        setView('edit');
        setShowStatePicker(false);
        setFormError('');
    };

    const handleDeleteZone = async (zoneId) => {
        await shippingService.deleteZone(zoneId);
        loadZones();
    };

    const handleSaveZone = async () => {
        const validationError = validateZoneDraft(draftZone);
        if (validationError) {
            setFormError(validationError);
            return;
        }
        const existing = zones.find(z => z.id === draftZone.id);
        if (existing) {
            await shippingService.updateZone(draftZone.id, draftZone);
        } else {
            const { id: _id, ...payload } = draftZone;
            await shippingService.createZone(payload);
        }
        loadZones();
        setView('list');
        setDraftZone(null);
        setFormError('');
    };

    const handleCancelEdit = () => {
        setView('list');
        setDraftZone(null);
        setShowStatePicker(false);
        setFormError('');
    };

    const toggleState = (stateName) => {
        if (!draftZone) return;
        setDraftZone(prev => {
            const exists = prev.states.includes(stateName);
            return {
                ...prev,
                states: exists ? prev.states.filter(s => s !== stateName) : [...prev.states, stateName]
            };
        });
    };

    const clearStates = () => {
        if (!draftZone) return;
        setDraftZone(prev => ({ ...prev, states: [] }));
    };

    const unavailableStates = useMemo(() => {
        if (!draftZone) return new Set();
        const currentZoneId = draftZone.id;
        const blocked = new Set();
        zones.forEach((zone) => {
            if (String(zone.id) === String(currentZoneId)) return;
            (zone.states || []).forEach((stateName) => blocked.add(stateName));
        });
        return blocked;
    }, [draftZone, zones]);

    const availableStates = useMemo(() => {
        if (!draftZone) return [];
        return STATES.filter((stateName) => {
            if (draftZone.states.includes(stateName)) return true;
            return !unavailableStates.has(stateName);
        });
    }, [draftZone, unavailableStates]);

    const selectableStateCount = useMemo(() => {
        return availableStates.length;
    }, [availableStates]);

    const zoneRatesRange = (zone) => {
        if (!zone.options?.length) return '—';
        const rates = zone.options.map(o => Number(o.rate || 0));
        const min = Math.min(...rates);
        const max = Math.max(...rates);
        return `₹${min.toFixed(2)} - ₹${max.toFixed(2)}`;
    };

    const openOptionModal = (option = null) => {
        if (option) {
            setEditingOptionId(option.id);
            setOptionDraft({ ...option });
        } else {
            setEditingOptionId(null);
            setOptionDraft(emptyOption());
        }
        setOptionModalOpen(true);
    };

    const closeOptionModal = () => {
        setOptionModalOpen(false);
        setEditingOptionId(null);
        setOptionDraft(emptyOption());
    };

    const saveOption = () => {
        if (!draftZone) return;
        if (!optionDraft.name.trim()) return;
        const nextOptions = editingOptionId
            ? draftZone.options.map(o => o.id === editingOptionId ? optionDraft : o)
            : [...draftZone.options, optionDraft];
        setDraftZone(prev => ({ ...prev, options: nextOptions }));
        closeOptionModal();
    };

    const deleteOption = (optionId) => {
        if (!draftZone) return;
        setDraftZone(prev => ({
            ...prev,
            options: prev.options.filter(o => o.id !== optionId)
        }));
    };

    const conditionLabel = (option) => {
        if (!option) return '—';
        const min = option.min || '0';
        const max = option.max || '—';
        if (option.conditionType === 'weight') {
            return `${min}kg - ${max === '—' ? 'and up' : `${max}kg`}`;
        }
        return `₹${min} - ${max === '—' ? 'and up' : `₹${max}`}`;
    };

    const selectedStatesLabel = useMemo(() => {
        if (!draftZone) return '';
        if (draftZone.states.length === 0) return 'No states selected';
        return `${draftZone.states.length} of ${selectableStateCount} states`;
    }, [draftZone, selectableStateCount]);

    return (
        <div className="space-y-6 animate-fade-in">
            {view === 'list' && (
                <>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl md:text-3xl font-serif text-primary font-bold">Shipping</h1>
                            <p className="text-gray-500 text-sm mt-1">
                                Create shipping zones and define rate rules for each region.
                            </p>
                        </div>
                        <button
                            onClick={handleCreateZone}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light transition-all"
                        >
                            <Plus size={18} /> Create zone
                        </button>
                    </div>

                    <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <Truck size={70} className="bg-emboss-icon absolute right-2 bottom-2 text-gray-100" />
                        <div className="grid grid-cols-4 gap-2 px-6 py-4 text-xs uppercase tracking-widest text-gray-400 font-semibold bg-gray-50 border-b border-gray-200">
                            <span className="col-span-1">Shipping zone</span>
                            <span className="col-span-2">States</span>
                            <span className="col-span-1 text-right">Rates</span>
                        </div>
                        {isLoading && (
                            <div className="px-6 py-10 text-center text-gray-400">Loading zones...</div>
                        )}
                        {!isLoading && zones.length === 0 && (
                            <div className="px-6 py-12 text-center text-gray-400 flex flex-col items-center gap-4">
                                <img src={shippingIllustration} alt="Shipping" className="w-40 h-40 object-contain opacity-85" />
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-700">No shipping zones available</h3>
                                    <p className="text-sm text-gray-500 mt-2">Create your first zone to define shipping rates by state.</p>
                                </div>
                            </div>
                        )}
                        {zones.map(zone => (
                            <div key={zone.id} className="grid grid-cols-4 gap-2 px-6 py-5 border-b border-gray-100 items-center">
                                <div className="col-span-1">
                                    <p className="font-semibold text-gray-800">{zone.name || 'Untitled zone'}</p>
                                </div>
                                <div className="col-span-2 text-sm text-gray-500">
                                    {zone.states?.length ? `${zone.states.length} states selected` : 'No states selected'}
                                </div>
                                <div className="col-span-1 flex items-center justify-end gap-3">
                                    <span className="text-sm font-semibold text-gray-700">{zoneRatesRange(zone)}</span>
                                    <button onClick={() => handleEditZone(zone)} className="p-2 rounded-full hover:bg-gray-100">
                                        <Pencil size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteZone(zone.id)} className="p-2 rounded-full hover:bg-red-50 text-red-500">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {view === 'edit' && draftZone && (
                <>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                        <button onClick={handleCancelEdit} className="flex items-center gap-2 text-primary font-semibold">
                            <ArrowLeft size={16} /> Back to shipping
                        </button>
                    </div>

                    <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <Truck size={70} className="bg-emboss-icon absolute right-2 bottom-2 text-gray-100" />
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-bold text-gray-800">Shipping zone</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Name this shipping zone and add the states you’ll ship to.
                            </p>
                        </div>
                        <div className="p-6 space-y-6">
                            <div>
                                <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Name</label>
                                <input
                                    value={draftZone.name}
                                    onChange={(e) => setDraftZone(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="North India"
                                    className="input-field mt-2"
                                />
                                <p className="text-xs text-gray-400 mt-2">This name will be visible to customers.</p>
                            </div>

                            <div>
                                <label className="text-xs font-bold uppercase tracking-widest text-gray-400">States</label>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm">
                                        India | {selectedStatesLabel}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowStatePicker((prev) => !prev)}
                                        className="px-3 py-1 rounded-full border border-gray-200 text-sm font-semibold text-primary hover:bg-primary/5"
                                    >
                                        {showStatePicker ? 'Close' : 'Select states'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!draftZone) return;
                                            setDraftZone(prev => ({ ...prev, states: [...availableStates] }));
                                        }}
                                        className="text-xs font-semibold text-gray-500 hover:text-primary"
                                    >
                                        Select all
                                    </button>
                                    <button type="button" onClick={clearStates} className="text-xs font-semibold text-gray-500 hover:text-primary">
                                        Clear
                                    </button>
                                </div>

                                {showStatePicker && (
                                    <div className="mt-4 rounded-2xl border border-gray-200 p-4 bg-white shadow-lg">
                                        {availableStates.length === 0 ? (
                                            <div className="text-sm text-gray-500 text-center py-6">
                                                All states are already assigned to other zones.
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-64 overflow-auto">
                                            {availableStates.map((stateName) => {
                                                const selected = draftZone.states.includes(stateName);
                                                return (
                                                    <button
                                                        key={stateName}
                                                        type="button"
                                                        onClick={() => toggleState(stateName)}
                                                        className={`px-3 py-2 rounded-lg text-sm text-left transition-all border ${
                                                            selected
                                                                ? 'border-primary bg-primary/10 text-primary font-semibold'
                                                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        {stateName}
                                                    </button>
                                                );
                                            })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
                        <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-100">
                            <div>
                                <h2 className="text-xl font-bold text-gray-800">Shipping options</h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    Add available shipping options for this zone.
                                </p>
                                <p className="text-xs text-gray-400 mt-2">
                                    If both price and weight rules can match the same cart, the lowest eligible shipping rate is applied.
                                </p>
                            </div>
                            <button
                                onClick={() => openOptionModal()}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 font-semibold text-primary hover:bg-primary/5"
                            >
                                <Plus size={16} /> Add option
                            </button>
                        </div>

                        <div className="p-6">
                            {formError && (
                                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    {formError}
                                </div>
                            )}
                            {draftZone.options.length === 0 && (
                                <div className="text-center text-gray-400 py-10">
                                    No shipping options yet. Add one to get started.
                                </div>
                            )}
                            {draftZone.options.length > 0 && (
                                <div className="rounded-2xl border border-gray-200 overflow-hidden">
                                    <div className="grid grid-cols-4 gap-2 px-5 py-3 text-xs uppercase tracking-widest text-gray-400 font-semibold bg-gray-50 border-b border-gray-200">
                                        <span>Option</span>
                                        <span>Condition</span>
                                        <span>Rate</span>
                                        <span className="text-right">Action</span>
                                    </div>
                                    {draftZone.options.map((option) => (
                                        <div key={option.id} className="grid grid-cols-4 gap-2 px-5 py-4 border-b border-gray-100 items-center">
                                            <span className="text-sm font-semibold text-gray-800">{option.name}</span>
                                            <span className="text-sm text-gray-500">{conditionLabel(option)}</span>
                                            <span className="text-sm font-semibold text-gray-800">₹{Number(option.rate || 0).toFixed(2)}</span>
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => openOptionModal(option)} className="p-2 rounded-full hover:bg-gray-100">
                                                    <Pencil size={16} />
                                                </button>
                                                <button onClick={() => deleteOption(option.id)} className="p-2 rounded-full hover:bg-red-50 text-red-500">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button onClick={handleCancelEdit} className="px-5 py-2 rounded-xl border border-gray-200 font-semibold text-gray-500 hover:bg-gray-50">
                            Cancel
                        </button>
                        <button onClick={handleSaveZone} className="px-6 py-2 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light">
                            Save zone
                        </button>
                    </div>
                </>
            )}

            {optionModalOpen && createPortal(
                <div className="fixed inset-0 z-[220] flex items-start sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-6 max-h-[calc(100vh-2rem)] overflow-y-auto my-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-800">
                                {editingOptionId ? 'Edit shipping option' : 'Add shipping option'}
                            </h3>
                            <button onClick={closeOptionModal} className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Name</label>
                                <input
                                    value={optionDraft.name}
                                    onChange={(e) => setOptionDraft(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Standard shipping"
                                    className="input-field mt-2"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Shipping rate</label>
                                <div className="relative mt-2">
                                    <span className="absolute left-4 top-3 text-gray-400">₹</span>
                                    <input
                                        value={optionDraft.rate}
                                        onChange={(e) => setOptionDraft(prev => ({ ...prev, rate: e.target.value.replace(/[^0-9.]/g, '') }))}
                                        placeholder="0.00"
                                        className="input-field pl-8"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Condition type</label>
                                <div className="mt-3 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setOptionDraft(prev => ({ ...prev, conditionType: 'price' }))}
                                        className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-all ${
                                            optionDraft.conditionType === 'price'
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >
                                        Order price
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOptionDraft(prev => ({ ...prev, conditionType: 'weight' }))}
                                        className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-all ${
                                            optionDraft.conditionType === 'weight'
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >
                                        Order weight
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                        Minimum {optionDraft.conditionType === 'weight' ? 'weight (kg)' : 'order price'}
                                    </label>
                                    <input
                                        value={optionDraft.min}
                                        onChange={(e) => setOptionDraft(prev => ({ ...prev, min: e.target.value.replace(/[^0-9.]/g, '') }))}
                                        placeholder="0"
                                        className="input-field mt-2"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                        Maximum {optionDraft.conditionType === 'weight' ? 'weight (kg)' : 'order price'}
                                    </label>
                                    <input
                                        value={optionDraft.max}
                                        onChange={(e) => setOptionDraft(prev => ({ ...prev, max: e.target.value.replace(/[^0-9.]/g, '') }))}
                                        placeholder="And up"
                                        className="input-field mt-2"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button onClick={closeOptionModal} className="px-5 py-2 rounded-xl border border-gray-200 font-semibold text-gray-500 hover:bg-gray-50">
                                Cancel
                            </button>
                            <button onClick={saveOption} className="px-6 py-2 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light">
                                {editingOptionId ? 'Save' : 'Add'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
