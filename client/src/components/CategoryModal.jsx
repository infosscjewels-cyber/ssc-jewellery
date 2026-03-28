import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderPlus, Image as ImageIcon, Loader2 } from 'lucide-react';

export default function CategoryModal({ isOpen, onClose, onConfirm, isLoading, initialData = null, disableNameEdit = false, subCategoriesEnabled = false }) {
    const [name, setName] = useState('');
    const [selectedImage, setSelectedImage] = useState(null); // Preview URL
    const [imageFile, setImageFile] = useState(null); // Actual File
    const [isDropActive, setIsDropActive] = useState(false);
    const [subCategories, setSubCategories] = useState([]);
    const [subCategoryInput, setSubCategoryInput] = useState('');

    // Reset or Pre-fill state when opening
    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                // Edit Mode
                setName(initialData.name || '');
                setSelectedImage(initialData.image_url || null);
                setSubCategories(Array.isArray(initialData.subCategories) ? initialData.subCategories : []);
            } else {
                // Create Mode
                setName('');
                setSelectedImage(null);
                setSubCategories([]);
            }
            setSubCategoryInput('');
            setImageFile(null);
        }
    }, [isOpen, initialData]);

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            setSelectedImage(URL.createObjectURL(file)); // Create local preview
        }
    };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDropActive(false);
        const file = e.dataTransfer?.files?.[0];
        if (!file || !String(file.type || '').startsWith('image/')) return;
        setImageFile(file);
        setSelectedImage(URL.createObjectURL(file));
    };

    const addSubCategory = () => {
        const trimmed = String(subCategoryInput || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        if (!trimmed) return;
        setSubCategories((prev) => {
            if (prev.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) return prev;
            return [...prev, trimmed].sort((a, b) => a.localeCompare(b));
        });
        setSubCategoryInput('');
    };

    const removeSubCategory = (entryToRemove) => {
        setSubCategories((prev) => prev.filter((entry) => entry !== entryToRemove));
    };

    const handleSubmit = () => {
        if (!name.trim()) return;
        onConfirm(name, imageFile, subCategories);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>

            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[calc(100vh-2rem)] relative z-10 overflow-hidden animate-in zoom-in-95 flex flex-col">
                <div className="h-2 w-full bg-primary"></div>

                <div className="p-6 overflow-y-auto flex-1">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 rounded-full bg-primary/10 text-primary">
                            <FolderPlus size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">
                            {initialData ? 'Edit Category' : 'New Category'}
                        </h3>
                    </div>

                    <div className="space-y-4">
                        {/* Name Input */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category Name</label>
                            <input 
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                                placeholder="e.g. Necklaces"
                                disabled={disableNameEdit}
                                autoFocus
                            />
                            {disableNameEdit && (
                                <p className="text-[11px] text-gray-500 mt-1">Name is locked for system categories.</p>
                            )}
                        </div>

                        {/* Image Upload */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cover Image (Optional)</label>
                            <div className="relative group cursor-pointer">
                                <input 
                                    type="file" 
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                                />
                                <div
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setIsDropActive(true);
                                    }}
                                    onDragLeave={(e) => {
                                        e.preventDefault();
                                        setIsDropActive(false);
                                    }}
                                    onDrop={handleDrop}
                                    className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center transition-all ${
                                        isDropActive
                                            ? 'border-primary bg-primary/10'
                                            : selectedImage
                                                ? 'border-primary bg-primary/5'
                                                : 'border-gray-300 hover:border-primary hover:bg-gray-50'
                                    }`}
                                >
                                    {selectedImage ? (
                                        <div className="relative w-full h-32 rounded-lg overflow-hidden shadow-sm">
                                            <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-bold">
                                                Change Image
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-4">
                                            <ImageIcon className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                            <p className="text-sm text-gray-500">Click to upload image</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {subCategoriesEnabled && (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sub Categories</label>
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <input
                                            value={subCategoryInput}
                                            onChange={(e) => setSubCategoryInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    addSubCategory();
                                                }
                                            }}
                                            className="min-w-0 flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                                            placeholder="e.g. 18gm Chains"
                                        />
                                        <button
                                            type="button"
                                            onClick={addSubCategory}
                                            className="shrink-0 px-4 py-2.5 text-sm font-bold text-primary border border-primary/20 bg-white hover:bg-primary/5 rounded-xl transition-colors"
                                        >
                                            Add
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {subCategories.length > 0 ? subCategories.map((entry) => (
                                            <span
                                                key={entry}
                                                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
                                            >
                                                {entry}
                                                <button
                                                    type="button"
                                                    onClick={() => removeSubCategory(entry)}
                                                    className="text-gray-400 hover:text-red-500"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </span>
                                        )) : (
                                            <p className="text-xs text-gray-500">Add reusable subcategories here so staff can pick them while tagging products.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 mt-8">
                        <button 
                            onClick={onClose}
                            className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
                            disabled={isLoading}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSubmit}
                            disabled={isLoading || !name.trim()}
                            className="px-6 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-light rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isLoading && <Loader2 size={16} className="animate-spin" />}
                            {initialData ? 'Save Changes' : 'Create Category'}
                        </button>
                    </div>
                </div>

                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1">
                    <X size={20} />
                </button>
            </div>
        </div>
        ,
        document.body
    );
}
