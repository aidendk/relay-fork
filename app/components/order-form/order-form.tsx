import { useState, useRef } from 'react';
import styles from './order-form.module.css';
import { mutate } from 'swr';
import { useToast } from '../toast/use-toast';
import { upload } from '@vercel/blob/client';
import { useSession } from 'next-auth/react';
import { CAR_YEARS, CURRENT_CAR_YEAR } from '../../lib/car-year';
import { FileSpreadsheet, FileText, Link2, ListPlus, Package, Plus, Upload, X } from 'lucide-react';

const STEPS = ['Order details', 'Cost split', 'How to submit', 'Items'];

const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface ModalProps {
    title: string;
    step?: number;
    size?: 'small' | 'wide';
    onClose: () => void;
    footer?: React.ReactNode;
    children: React.ReactNode;
}

// No close on overlay click or Escape: an accidental click would throw away a half-filled order.
function Modal({ title, step, size, onClose, footer, children }: ModalProps) {
    const sizeClass = size === 'small' ? styles.formContainerSmall : size === 'wide' ? styles.formContainerWide : '';
    return (
        <div className={styles.formBG}>
            <div className={`${styles.formContainer} ${sizeClass}`} role="dialog" aria-modal="true" aria-labelledby="order-form-title">
                <header className={styles.formHeader}>
                    <div className={styles.titleBlock}>
                        <h2 id="order-form-title" className={styles.formTitle}>{title}</h2>
                        {step !== undefined && (
                            <p className={styles.meta}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
                        )}
                    </div>
                    <button className={styles.iconButton} onClick={onClose} aria-label="Close" title="Close">
                        <X size={16} aria-hidden />
                    </button>
                </header>
                {step !== undefined && (
                    <div className={styles.progress} role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
                        <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
                    </div>
                )}
                <div className={styles.formBody}>{children}</div>
                {footer && <footer className={styles.buttonGroup}>{footer}</footer>}
            </div>
        </div>
    );
}

interface OrderFormProps {
    onClose: () => void;
}

interface OrderData {
    orderName: string;
    vendor: string;
    notes: string;
    estimatedCost: number;
    costBreakdown: {
        AERO: number;
        CHS: number;
        SUS: number;
        BAT: number;
        ECE: number;
        PT: number;
        SW: number;
        DBMS: number;
        OPS: number;
        FACIL: number;
        FLEET: number;
        MKTG: number;
        VD: number;
    };
    supportingDocs: { name: string; url: string }[];
    deliveryLocation: string;
    carYear: string;
}

export default function OrderForm({ onClose }: OrderFormProps) {
    const { toast } = useToast();
    const { data: session } = useSession();
    const email = session?.user.email;
    const [currentScreen, setCurrentScreen] = useState(0);
    const [overbudgetSubteams, setOverbudgetSubteams] = useState<string[]>([]);
    const [orderData, setOrderData] = useState<OrderData>({
        orderName: '',
        vendor: '',
        notes: '',
        estimatedCost: 0,
        costBreakdown: {
            AERO: 0,
            CHS: 0,
            SUS: 0,
            BAT: 0,
            ECE: 0,
            PT: 0,
            SW: 0,
            DBMS: 0,
            OPS: 0,
            FACIL: 0,
            FLEET: 0,
            MKTG: 0,
            VD: 0,
        },
        supportingDocs: [],
        deliveryLocation: '',
        carYear: CURRENT_CAR_YEAR,
    });

    const handleNext = () => setCurrentScreen(currentScreen + 1);
    const handleBack = () => setCurrentScreen(currentScreen - 1);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setOrderData({ ...orderData, [name]: value });
    };

    const handleCostBreakdownChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setOrderData({
            ...orderData,
            costBreakdown: { ...orderData.costBreakdown, [name]: Number(value) },
        });
    };

    const handleSubmitCSV = async (file: File) => {
        const totalCostPercentage = Object.values(orderData.costBreakdown).reduce((a, b) => a + b, 0);
        if (totalCostPercentage !== 100) {
            toast({
                title: "Invalid Cost Breakdown",
                description: "Cost breakdown percentages must add up to 100%",
                variant: "destructive",
            });
            return;
        }

        const formData = new FormData();

        formData.append('file', file);
        formData.append('orderName', orderData.orderName);
        formData.append('vendor', orderData.vendor);
        formData.append('notes', orderData.notes);
        formData.append('estimatedCost', String(orderData.estimatedCost));
        formData.append('userEmail', email || '');
        formData.append('deliveryLocation', orderData.deliveryLocation);
        formData.append('carYear', orderData.carYear);
        for (const [key, value] of Object.entries(orderData.costBreakdown)) {
            formData.append(`costBreakdown[${key}]`, String(value));
        }

        orderData.supportingDocs.forEach((doc, index) => {
            formData.append(`supportingDocs[${index}][name]`, doc.name);
            formData.append(`supportingDocs[${index}][url]`, doc.url);
        });

        try {
            const response = await fetch('/api/orders/upload', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                if (data.needsApproval) {
                    setOverbudgetSubteams(data.exceededSubteams || []);
                    setCurrentScreen(6);
                    mutate('/api/orders/pending');
                } else {
                    toast({
                        title: "Order Created",
                        description: "Order created successfully!",
                        variant: "affirmation",
                    });
                    mutate((key: string) => typeof key === 'string' && key.startsWith('/api/orders'));
                    mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
                    onClose();
                }
            } else {
                const errorData = await response.json();
                toast({
                    title: "Error",
                    description: `Error: ${errorData.error}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error('Upload error:', error);
            toast({
                title: "Upload Error",
                description: "An error occurred while uploading the file.",
                variant: "destructive",
            });
        }
    };

    const onNextStep = (index: number) => {
        setCurrentScreen(index);
    };

    const screens = [
        <GeneralInfoScreen
            key="general-info"
            orderData={orderData}
            setOrderData={setOrderData}
            onInputChange={handleInputChange}
            onNext={handleNext}
            onClose={onClose}
        />,
        <CostBreakdownScreen
            key="cost-breakdown"
            costBreakdown={orderData.costBreakdown}
            estimatedCost={Number(orderData.estimatedCost)}
            onCostChange={handleCostBreakdownChange}
            onNext={handleNext}
            onBack={handleBack}
            onClose={onClose}
        />,
        <Method
            key="method"
            handleSubmitCSV={handleSubmitCSV}
            onBack={handleBack}
            onClose={onClose}
            onNextStep={onNextStep}
        />,
        <TemplateEntryForm
            key="template-entry"
            orderData={orderData}
            onBack={() => setCurrentScreen(2)}
            onClose={onClose}
            onOverbudget={(subteams: string[]) => {
                setOverbudgetSubteams(subteams);
                setCurrentScreen(6);
            }}
        />,
        <CartLinkOrder
            key="cart-link-order"
            orderData={orderData}
            onBack={() => setCurrentScreen(2)}
            onClose={onClose}
            onOverbudget={(subteams: string[]) => {
                setOverbudgetSubteams(subteams);
                setCurrentScreen(6);
            }}
        />,
        <SingleItemOrder
            key="single-item-order"
            orderData={orderData}
            onBack={() => setCurrentScreen(2)}
            onClose={onClose}
            onOverbudget={(subteams: string[]) => {
                setOverbudgetSubteams(subteams);
                setCurrentScreen(6);
            }}
        />,
        <OverBudgetScreen
            key="over-budget"
            subteams={overbudgetSubteams}
            onClose={onClose}
        />,
    ];

    return screens[currentScreen];
}

interface GeneralInfoScreenProps {
    orderData: OrderData;
    onInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    onNext: () => void;
    onClose: () => void;
    setOrderData: React.Dispatch<React.SetStateAction<OrderData>>;
}

function GeneralInfoScreen({ orderData, onInputChange, onNext, onClose, setOrderData }: GeneralInfoScreenProps) {
    const [showCustomDelivery, setShowCustomDelivery] = useState(false);
    const [customDelivery, setCustomDelivery] = useState('')
    const deliveryLocationValid = showCustomDelivery ? !!customDelivery : !!orderData.deliveryLocation;
    const isNextDisabled = !orderData.orderName || 
                        !orderData.vendor || 
                        orderData.estimatedCost <= 0 || 
                        !deliveryLocationValid;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);
    const { toast } = useToast();

    const handleNextClick = () => {
        if (isNextDisabled) {
            const text = "Please fill in the order name, vendor, estimated cost, and delivery location to continue.";
            toast({
                title: "Incomplete Information",
                description: text,
                variant: "destructive",
            });
        } else {
            if (showCustomDelivery) {
                orderData.deliveryLocation = customDelivery;
            }
            onNext();
        }
    };

    const handleCustomDelivery = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { value } = e.target;
        if (value === 'Other') {
            setShowCustomDelivery(true);
        } else {
            setShowCustomDelivery(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        
        if (!file || file.type !== 'application/pdf') {
            toast({
                title: "Invalid File",
                description: "Please upload a valid PDF file.",
                variant: "destructive",
            });
            return;
        }

        try {
            const { url } = await upload(file.name, file, {
                access: 'public',
                handleUploadUrl: '/api/orders/addAttachment',
            });

            const newFile = { name: file.name, url };

            setOrderData((prevData) => ({
                ...prevData,
                supportingDocs: [...prevData.supportingDocs, { name: file.name, url }],
            }));

            setUploadedFiles((prevFiles) => [...prevFiles, newFile]);

            toast({
                title: "File Uploaded",
                description: "Your PDF was successfully uploaded.",
                variant: "affirmation",
            });
        } catch (error) {
            console.error('Upload error:', error);
            console.error('Error message:', error instanceof Error ? error.message : String(error));
            toast({
                title: "Upload Error",
                description: "An error occurred while uploading the PDF.",
                variant: "destructive",
            });
        }
    };



    return (
        <Modal
            title="Place order"
            step={0}
            onClose={onClose}
            footer={
                <div className={styles.footerEnd}>
                    <button className={`${styles.button} ${styles.cancelButton}`} onClick={onClose}>Cancel</button>
                    <button className={`${styles.button} ${styles.primaryButton}`} onClick={handleNextClick}>Next</button>
                </div>
            }
        >
            <section className={styles.section}>
                <div className={styles.fieldGrid}>
                    <div className={styles.field}>
                        <label htmlFor="of-name">Order name <span className={styles.required}>*</span></label>
                        <input
                            id="of-name"
                            type="text"
                            name="orderName"
                            placeholder="The main item, e.g. 4130 steel tube"
                            value={orderData.orderName}
                            onChange={onInputChange}
                        />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="of-vendor">Vendor <span className={styles.required}>*</span></label>
                        <input
                            id="of-vendor"
                            type="text"
                            name="vendor"
                            placeholder="e.g. McMaster-Carr"
                            value={orderData.vendor}
                            onChange={onInputChange}
                        />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="of-cost">Estimated total cost <span className={styles.required}>*</span></label>
                        <div className={styles.affix}>
                            <span aria-hidden>$</span>
                            <input
                                id="of-cost"
                                type="number"
                                step="0.01"
                                min={0}
                                name="estimatedCost"
                                placeholder="0.00"
                                value={orderData.estimatedCost || ''}
                                onChange={onInputChange}
                            />
                        </div>
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="of-delivery">Deliver to <span className={styles.required}>*</span></label>
                        <select
                            id="of-delivery"
                            name="deliveryLocation"
                            value={showCustomDelivery ? 'Other' : orderData.deliveryLocation}
                            onChange={(e) => {
                                handleCustomDelivery(e);
                                if (e.target.value === 'Other') {
                                    orderData.deliveryLocation = '';
                                } else {
                                    onInputChange(e);
                                }
                            }}
                        >
                            <option value=''>Choose a location</option>
                            <option value='Instrumentation'>Instrumentation</option>
                            <option value='FEDC'>FEDC</option>
                            <option value='USB'>USB</option>
                            <option value='Thompson'>Thompson</option>
                            <option value='Other'>Other…</option>
                        </select>
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="of-car-year">Car <span className={styles.required}>*</span></label>
                        <select
                            id="of-car-year"
                            name="carYear"
                            value={orderData.carYear}
                            onChange={onInputChange}
                        >
                            {CAR_YEARS.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                    {showCustomDelivery && (
                        <div className={`${styles.field} ${styles.span2}`}>
                            <label htmlFor="of-custom-delivery">Delivery location <span className={styles.required}>*</span></label>
                            <input
                                id="of-custom-delivery"
                                type="text"
                                name="deliveryLocation"
                                placeholder="Building and room"
                                value={customDelivery}
                                onChange={(e) => setCustomDelivery(e.target.value)}
                                autoFocus
                            />
                        </div>
                    )}
                    <div className={`${styles.field} ${styles.span2}`}>
                        <label htmlFor="of-notes">Notes <span className={styles.optional}>optional</span></label>
                        <textarea
                            id="of-notes"
                            name="notes"
                            placeholder="Anything purchasing should know"
                            value={orderData.notes}
                            onChange={onInputChange}
                            className={styles.textarea}
                            rows={3}
                        />
                    </div>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>Supporting documents <span className={styles.optional}>optional</span></h3>
                    <button className={`${styles.button} ${styles.ghostButton}`} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={14} aria-hidden />
                        Upload PDF
                    </button>
                    <input
                        type="file"
                        accept="application/pdf"
                        ref={fileInputRef}
                        className={styles.fileInput}
                        onChange={handleFileUpload}
                    />
                </div>
                {uploadedFiles.length > 0 ? (
                    <ul className={styles.fileList}>
                        {uploadedFiles.map((file, index) => (
                            <li key={index} className={styles.fileRow}>
                                <a href={file.url} target="_blank" rel="noopener noreferrer" className={styles.fileLink} title={file.name}>
                                    <FileText size={16} aria-hidden />
                                    <span className={styles.fileName}>{file.name}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className={styles.emptyFiles}>Quotes or spec sheets as PDF, if purchasing needs them.</p>
                )}
            </section>
        </Modal>
    );
}

interface CostBreakdownScreenProps {
    costBreakdown: Record<string, number>;
    estimatedCost: number;
    onCostChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onNext: () => void;
    onBack: () => void;
    onClose: () => void;
}

function CostBreakdownScreen({ costBreakdown, estimatedCost, onCostChange, onNext, onBack, onClose }: CostBreakdownScreenProps) {
    const totalPercentage = Object.values(costBreakdown).reduce((a, b) => (a as number) + (b as number), 0);
    const isNextDisabled = totalPercentage !== 100;

    const { toast } = useToast();

    const handleNextClick = () => {
        if (isNextDisabled) {
            toast({
                title: "Incomplete Information",
                description: "Please make sure the cost breakdown adds up to 100%.",
                variant: "destructive",
            });
        } else {
            onNext();
        }
    };

    const remaining = 100 - totalPercentage;

    return (
        <Modal
            title="Place order"
            step={1}
            onClose={onClose}
            footer={
                <div className={styles.footerEnd}>
                    <button className={`${styles.button} ${styles.cancelButton}`} onClick={onBack}>Back</button>
                    <button className={`${styles.button} ${styles.primaryButton}`} onClick={handleNextClick}>Next</button>
                </div>
            }
        >
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div>
                        <h3 className={styles.sectionTitle}>Which subteams pay for this?</h3>
                        <p className={styles.hint}>Split {money(estimatedCost)} by percentage. The split must total 100%.</p>
                    </div>
                    <span className={`${styles.total} ${totalPercentage === 100 ? styles.totalOk : styles.totalOff}`}>
                        {totalPercentage === 100
                            ? 'Total 100%'
                            : remaining > 0 ? `${totalPercentage}% · ${remaining}% left` : `${totalPercentage}% · ${-remaining}% over`}
                    </span>
                </div>
                <div className={styles.breakdownGrid}>
                    {['AERO', 'BAT', 'CHS', 'DBMS', 'ECE', 'PT', 'SUS', 'SW', 'OPS', 'FACIL', 'FLEET', 'MKTG', 'VD'].map((subteam) => {
                        const currentValue = costBreakdown[subteam] ?? 0;
                        return (
                            <label key={subteam} className={styles.breakdownItem}>
                                <span>{subteam}</span>
                                <span className={`${styles.affix} ${styles.affixEnd}`}>
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        name={subteam}
                                        placeholder="0"
                                        className={currentValue ? styles.filled : undefined}
                                        value={currentValue === 0 ? '' : currentValue}
                                        onChange={onCostChange}
                                    />
                                    <span aria-hidden>%</span>
                                </span>
                                <span className={styles.share}>
                                    {currentValue ? money((estimatedCost * currentValue) / 100) : '—'}
                                </span>
                            </label>
                        );
                    })}
                </div>
            </section>
        </Modal>
    );
}

interface MethodProps {
    handleSubmitCSV: (file: File) => Promise<void>;
    onNextStep: (index: number) => void;
    onBack: () => void;
    onClose: () => void;
}

function Method({ handleSubmitCSV, onNextStep, onBack, onClose }: MethodProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.name.endsWith('.csv')) {
            try {
                await handleSubmitCSV(file);
            } catch (error) {
                console.error('Error uploading CSV:', error);
            }
        } else {
            toast({
                title: "Invalid File",
                description: "Please upload a valid CSV file.",
                variant: "destructive",
            });
        }
    };

    const methods = [
        { label: 'Item list', hint: 'Enter each part on its own row (MEEN template)', icon: ListPlus, onClick: () => onNextStep(3) },
        { label: 'Upload CSV', hint: 'A filled-in MEEN template exported as .csv', icon: FileSpreadsheet, onClick: () => fileInputRef.current?.click() },
        { label: 'Cart link', hint: 'Paste a vendor cart that already has everything in it', icon: Link2, onClick: () => onNextStep(4) },
        { label: 'Single item', hint: 'One part with a quantity and a price', icon: Package, onClick: () => onNextStep(5) },
    ];

    return (
        <Modal
            title="Place order"
            step={2}
            size="small"
            onClose={onClose}
            footer={<button className={`${styles.button} ${styles.cancelButton}`} onClick={onBack}>Back</button>}
        >
            <section className={styles.section}>
                <h3 className={styles.sectionTitle}>How do you want to add the items?</h3>
                <div className={styles.methodList}>
                    {methods.map(({ label, hint, icon: Icon, onClick }) => (
                        <button key={label} className={styles.methodOption} onClick={onClick}>
                            <Icon size={18} aria-hidden className={styles.methodIcon} />
                            <span className={styles.methodText}>
                                <span className={styles.methodLabel}>{label}</span>
                                <span className={styles.methodHint}>{hint}</span>
                            </span>
                        </button>
                    ))}
                </div>
                <input
                    type="file"
                    accept=".csv"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
            </section>
        </Modal>
    );
}

interface CartLinkOrderProps {
    orderData: OrderData;
    onBack: () => void;
    onClose: () => void;
    onOverbudget: (subteams: string[]) => void;
}

function CartLinkOrder({ orderData, onBack, onClose, onOverbudget }: CartLinkOrderProps) {
    const [cartLink, setCartLink] = useState('');
    const { data: session } = useSession();
    const email = session?.user.email;
    const { toast } = useToast();
    const handleSubmit = async () => {
        if (!cartLink) {
            toast({
                title: "Missing Cart Link",
                description: "Please provide a cart link.",
                variant: "destructive",
            });
            return;
        }

        const cartOrderData = {
            ...orderData,
            cartUrl: cartLink,
            comments: orderData.notes,
            costBreakdown: orderData.costBreakdown,
            supportingDocs: orderData.supportingDocs,
            userEmail: email,
            deliveryLocation: orderData.deliveryLocation,
        };

        try {
            const response = await fetch('/api/orders/place', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(cartOrderData),
            });

            if (response.ok) {
                const data = await response.json();
                if (data.needsApproval) {
                    mutate('/api/orders/pending');
                    onOverbudget(data.exceededSubteams || []);
                } else {
                    toast({
                        title: "Order Created",
                        description: "Order created successfully!",
                        variant: "affirmation",
                    });
                    mutate((key: string) => typeof key === 'string' && key.startsWith('/api/orders'));
                    mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
                    onClose();
                }
            } else {
                const error = await response.json();
                toast({
                    title: "Submission Error",
                    description: `Error: ${error.error}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error('Error submitting cart link order:', error);
            alert('An error occurred while submitting the order.');
        }
    };

    return (
        <Modal
            title="Place order"
            step={3}
            size="small"
            onClose={onClose}
            footer={
                <div className={styles.footerEnd}>
                    <button className={`${styles.button} ${styles.cancelButton}`} onClick={onBack}>Back</button>
                    <button className={`${styles.button} ${styles.primaryButton}`} onClick={handleSubmit}>Submit order</button>
                </div>
            }
        >
            <section className={styles.section}>
                <div className={styles.field}>
                    <label htmlFor="of-cart">Cart link <span className={styles.required}>*</span></label>
                    <input
                        id="of-cart"
                        type="url"
                        placeholder="https://www.mcmaster.com/order/…"
                        value={cartLink}
                        onChange={(e) => setCartLink(e.target.value)}
                        autoFocus
                    />
                    <p className={styles.hint}>Make sure the cart is shareable, so purchasing can open it without your login.</p>
                </div>
            </section>
        </Modal>
    );
}

interface SingleItemOrderProps {
    orderData: OrderData;
    onBack: () => void;
    onClose: () => void;
    onOverbudget: (subteams: string[]) => void;
}

function SingleItemOrder({ orderData, onBack, onClose, onOverbudget }: SingleItemOrderProps) {
    const [name, setName] = useState('');
    const [partNumber, setPartNumber] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [cost, setCost] = useState(0);
    const [link, setLink] = useState('');
    const { toast } = useToast();
    const { data: session } = useSession();
    const email = session?.user.email;

    const handleSubmit = async () => {
        if (!name || !quantity || !cost) {
            toast({
                title: "Missing Fields",
                description: "Please fill in all required fields.",
                variant: "destructive",
            });
            return;
        }

        const singleOrderData = {
            ...orderData,
            totalCost: cost * quantity,
            items: [
                {
                    itemName: name,
                    partNumber,
                    quantity,
                    cost,
                    link,
                },
            ],
            comments: orderData.notes,
            costBreakdown: orderData.costBreakdown,
            supportingDocs: orderData.supportingDocs,
            userEmail: email,
            deliveryLocation: orderData.deliveryLocation,
        };

        try {
            const response = await fetch('/api/orders/place', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(singleOrderData),
            });

            if (response.ok) {
                const data = await response.json();
                if (data.needsApproval) {
                    mutate('/api/orders/pending');
                    onOverbudget(data.exceededSubteams || []);
                } else {
                    toast({
                        title: "Order Created",
                        description: "Order created successfully!",
                        variant: "affirmation",
                    });
                    mutate((key: string) => typeof key === 'string' && key.startsWith('/api/orders'));
                    mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
                    onClose();
                }
            } else {
                const error = await response.json();
                toast({
                    title: "Submission Error",
                    description: `Error: ${error.error}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error('Error submitting single item order:', error);
            alert('An error occurred while submitting the order.');
        }
    };

    return (
        <Modal
            title="Place order"
            step={3}
            onClose={onClose}
            footer={
                <>
                    <span className={styles.footerTotal}>Total <strong>{money(cost * quantity)}</strong></span>
                    <div className={styles.footerEnd}>
                        <button className={`${styles.button} ${styles.cancelButton}`} onClick={onBack}>Back</button>
                        <button className={`${styles.button} ${styles.primaryButton}`} onClick={handleSubmit}>Submit order</button>
                    </div>
                </>
            }
        >
            <section className={styles.section}>
                <div className={styles.fieldGrid}>
                    <div className={styles.field}>
                        <label htmlFor="si-name">Item name <span className={styles.required}>*</span></label>
                        <input id="si-name" type="text" placeholder="e.g. 1/4-20 socket head screw" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="si-part">Part number <span className={styles.optional}>optional</span></label>
                        <input id="si-part" type="text" placeholder="e.g. 91251A537" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="si-qty">Quantity <span className={styles.required}>*</span></label>
                        <input id="si-qty" type="number" min={1} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="si-cost">Cost per item <span className={styles.required}>*</span></label>
                        <div className={styles.affix}>
                            <span aria-hidden>$</span>
                            <input id="si-cost" type="number" step="0.01" min={0} placeholder="0.00" value={cost || ''} onChange={(e) => setCost(Number(e.target.value))} />
                        </div>
                    </div>
                    <div className={`${styles.field} ${styles.span2}`}>
                        <label htmlFor="si-link">Link to item <span className={styles.optional}>optional</span></label>
                        <input id="si-link" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
                    </div>
                </div>
            </section>
        </Modal>
    );
}

interface TemplateRow {
    itemName: string;
    partNumber: string;
    notes: string;
    quantity: number;
    cost: number;
    link: string;
}

function TemplateEntryForm({ orderData, onBack, onClose, onOverbudget }: {
    orderData: OrderData;
    onBack: () => void;
    onClose: () => void;
    onOverbudget: (subteams: string[]) => void;
}) {
    const [rows, setRows] = useState<TemplateRow[]>([
        { itemName: "", partNumber: "", notes: "", quantity: 1, cost: 0, link: "" },
    ]);
    const { toast } = useToast();
    const { data: session } = useSession();
    const email = session?.user.email;

    const addRow = () => setRows([...rows, { itemName: "", partNumber: "", notes: "", quantity: 1, cost: 0, link: "" }]);

    const updateRow = (index: number, field: keyof TemplateRow, value: string | number) => {
        const newRows = [...rows];
        (newRows[index][field] as unknown) = value;
        setRows(newRows);
    };

    const handleSubmit = async () => {
        if (rows.some(r => !r.itemName || !r.quantity || !r.cost)) {
            toast({
                title: "Missing Fields",
                description: "Each row needs Item Name, Quantity, and Cost.",
                variant: "destructive",
            });
            return;
        }

        const formData = new FormData();
        formData.append("orderName", orderData.orderName);
        formData.append("vendor", orderData.vendor);
        formData.append("notes", orderData.notes);
        formData.append("estimatedCost", String(orderData.estimatedCost));
        formData.append("userEmail", email || "");
        formData.append("deliveryLocation", orderData.deliveryLocation);
        formData.append("carYear", orderData.carYear);

        for (const [key, value] of Object.entries(orderData.costBreakdown)) {
            formData.append(`costBreakdown[${key}]`, String(value));
        }

        orderData.supportingDocs.forEach((doc, index) => {
            formData.append(`supportingDocs[${index}][name]`, doc.name);
            formData.append(`supportingDocs[${index}][url]`, doc.url);
        });

        rows.forEach((row, i) => {
            formData.append(`items[${i}][itemName]`, row.itemName);
            formData.append(`items[${i}][partNumber]`, row.partNumber);
            formData.append(`items[${i}][notes]`, row.notes);
            formData.append(`items[${i}][vendor]`, orderData.vendor);
            formData.append(`items[${i}][quantity]`, String(row.quantity));
            formData.append(`items[${i}][cost]`, String(row.cost));
            formData.append(`items[${i}][link]`, row.link);
        });

        try {
            const response = await fetch("/api/orders/upload", {
                method: "POST",
                body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                if (data.needsApproval) {
                    mutate('/api/orders/pending');
                    onOverbudget(data.exceededSubteams || []);
                } else {
                    toast({
                        title: "Order Created",
                        description: "Order created successfully!",
                        variant: "affirmation",
                    });
                    mutate((key: string) => typeof key === 'string' && key.startsWith('/api/orders'));
                    onClose();
                }
            } else {
                const errorData = await response.json();
                toast({
                    title: "Error",
                    description: `Error: ${errorData.error}`,
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Upload error:", error);
            toast({
                title: "Upload Error",
                description: "An error occurred while submitting the order.",
                variant: "destructive",
            });
        }
    };

    const orderTotal = rows.reduce((sum, r) => sum + (r.quantity || 0) * (r.cost || 0), 0);

    return (
        <Modal
            title="Place order"
            step={3}
            size="wide"
            onClose={onClose}
            footer={
                <>
                    <span className={styles.footerTotal}>
                        {rows.length} {rows.length === 1 ? 'item' : 'items'} · Total <strong>{money(orderTotal)}</strong>
                    </span>
                    <div className={styles.footerEnd}>
                        <button className={`${styles.button} ${styles.cancelButton}`} onClick={onBack}>Back</button>
                        <button className={`${styles.button} ${styles.primaryButton}`} onClick={handleSubmit}>Submit order</button>
                    </div>
                </>
            }
        >
            <section className={styles.section}>
                <div className={styles.tableContainer}>
                    <div className={styles.tableHeader}>
                        <span>Item name <span className={styles.required}>*</span></span>
                        <span>Part number</span>
                        <span>Notes</span>
                        <span className={styles.numHead}>Qty <span className={styles.required}>*</span></span>
                        <span className={styles.numHead}>Cost each <span className={styles.required}>*</span></span>
                        <span className={styles.numHead}>Total</span>
                        <span>Link</span>
                        <span />
                    </div>

                    {rows.map((row, idx) => (
                        <div key={idx} className={styles.tableRow}>
                            <input
                                aria-label={`Item ${idx + 1} name`}
                                value={row.itemName}
                                onChange={(e) => updateRow(idx, "itemName", e.target.value)}
                            />
                            <input
                                aria-label={`Item ${idx + 1} part number`}
                                value={row.partNumber}
                                onChange={(e) => updateRow(idx, "partNumber", e.target.value)}
                            />
                            <input
                                aria-label={`Item ${idx + 1} notes`}
                                value={row.notes}
                                onChange={(e) => updateRow(idx, "notes", e.target.value)}
                            />
                            <input
                                aria-label={`Item ${idx + 1} quantity`}
                                type="number"
                                min={1}
                                className={styles.numInput}
                                value={row.quantity ?? ""}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    updateRow(idx, "quantity", val === "" ? "" : Number(val));
                                }}
                            />
                            <input
                                aria-label={`Item ${idx + 1} cost each`}
                                type="number"
                                step="0.01"
                                min={0}
                                placeholder="0.00"
                                className={styles.numInput}
                                value={row.cost || ""}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    updateRow(idx, "cost", val === "" ? "" : Number(val));
                                }}
                            />
                            <span className={styles.rowTotal}>{money((row.quantity || 0) * (row.cost || 0))}</span>
                            <input
                                aria-label={`Item ${idx + 1} link`}
                                type="url"
                                placeholder="https://"
                                value={row.link}
                                onChange={(e) => updateRow(idx, "link", e.target.value)}
                            />
                            <button
                                className={styles.iconButton}
                                onClick={() => {
                                    if (rows.length > 1) {
                                        setRows(rows.filter((_, i) => i !== idx));
                                    }
                                }}
                                disabled={rows.length === 1}
                                aria-label={`Remove item ${idx + 1}`}
                                title={rows.length === 1 ? "At least one row is required" : "Remove row"}
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </div>
                    ))}
                </div>
                <button className={`${styles.button} ${styles.ghostButton} ${styles.addRow}`} onClick={addRow}>
                    <Plus size={14} aria-hidden />
                    Add item
                </button>
            </section>
        </Modal>
    );
}

function OverBudgetScreen({ subteams, onClose }: { subteams: string[]; onClose: () => void }) {
    return (
        <Modal
            title="Order submitted for approval"
            size="small"
            onClose={onClose}
            footer={
                <div className={styles.footerEnd}>
                    <button className={`${styles.button} ${styles.primaryButton}`} onClick={onClose}>Got it</button>
                </div>
            }
        >
            <section className={styles.section}>
                <p className={styles.notice}>
                    This order would push <strong>{subteams.join(', ')}</strong> past{' '}
                    {subteams.length > 1 ? 'their budget limits' : 'its budget limit'} (or it already is…).
                </p>
                <p className={styles.bodyText}>
                    It has been submitted, but a PM needs to approve it before it goes through.
                    Track it in the <strong>Approvals</strong> tab.
                </p>
                <p className={styles.hint}>Alternatively, venmo Teymur $5 and I&apos;ve got you.</p>
            </section>
        </Modal>
    );
}