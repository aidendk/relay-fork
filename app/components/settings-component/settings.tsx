import React, { useRef, useState, useEffect } from 'react';
import styles from './settings-menu.module.css';
import { OrderStatus, ItemStatus, Item } from '@prisma/client';
import { useToast } from '../toast/use-toast';
import useSWR from 'swr';
import { SerializedOrderWithRelations } from '../order-table/order-table';
import { useSession } from 'next-auth/react';
import * as XLSX from 'xlsx';
import { Download, FileText, Trash2, Upload, X } from 'lucide-react';
import { checkAdmin, checkLead } from '../../lib/checkAdmin';
import { CAR_YEARS } from '../../lib/car-year';
import { SELECTABLE_ORDER_STATUSES } from '../../lib/order-status';

interface SettingsMenuProps {
    order: SerializedOrderWithRelations | null;
    item?: Item;
    onClose: () => void;
    onUpdateOrder: () => void;
}

interface Document {
    id: number;
    url: string;
    orderId: number;
    uploadedAt: string;
}

interface UpdateOrderBody {
    status: OrderStatus;
    totalCost?: number;
    costVerified?: boolean;
    carrier?: string;
    trackingId?: string;
    meenOrderId?: string;
    comments?: string;
    costBreakdown?: { [key: string]: number };
    carYear?: string;
    trouble?: boolean;
}

interface UpdateItemBody {
    status: ItemStatus;
}

const subteamMapping: { [key: string]: string } = {
    AERO: 'Aerodynamics',
    CHS: 'Chassis',
    SUS: 'Suspension',
    BAT: 'Battery',
    ECE: 'Electronics',
    PT: 'Powertrain',
    SW: 'Software',
    DBMS: 'Distributed BMS',
    OPS: 'Operations',
    FACIL: 'Facilities/Infrastructure',
    FLEET: 'Fleet Maintenance',
    MKTG: 'Marketing',
    VD: 'Vehicle Dynamics'
};

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = (status: string) => status.replace(/_/g, ' ');

const SettingsMenu: React.FC<SettingsMenuProps> = ({ order, item, onClose, onUpdateOrder }) => {
    const { data: session } = useSession();
    const email = session?.user.email;

    const [isAdmin, setIsAdmin] = useState(false);
    const [isLead, setIsLead] = useState(false);
    const [isAdminLoading, setIsAdminLoading] = useState(true);

    useEffect(() => {
        if (!session) {
            setIsAdmin(false);
            setIsLead(false);
            setIsAdminLoading(false);
            return;
        }

        Promise.all([checkAdmin(), checkLead()])
            .then(([admin, lead]) => {
                setIsAdmin(admin);
                setIsLead(lead);
            })
            .catch(() => {
                setIsAdmin(false);
                setIsLead(false);
            })
            .finally(() => setIsAdminLoading(false));
    }, [session]);

    const initialCostBreakdown = {
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
        ...(order?.costBreakdown || {}),
    };

    const [costBreakdown, setCostBreakdown] = useState<{ [key: string]: number }>(initialCostBreakdown);

    const [orderStatus, setOrderStatus] = useState<OrderStatus>(
        order ? order.status : OrderStatus.TO_ORDER
    );
    const [itemStatus, setItemStatus] = useState<ItemStatus>(
        item ? item.status : ItemStatus.TO_ORDER
    );
    const [price, setPrice] = useState(order ? order.totalCost : 0);
    const [priceEdited, setPriceEdited] = useState(false);

    const [receipts, setReceipts] = useState<Document[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const [comments, setComments] = useState(order?.comments || '');

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    // mousedown, not click, so a text-selection drag that ends on the overlay doesn't close the modal
    const handleOverlayMouseDown = (e: React.MouseEvent) => e.target === e.currentTarget && onClose();

    const [carrier, setCarrier] = useState<string>(order?.carrier || '');
    const [trackingId, setTrackingId] = useState<string>(order?.trackingId || '');
    const [meenOrderId, setMeenOrderId] = useState<string>(order?.meenOrderId || '');
    const [isPriceVerified, setIsPriceVerified] = useState(order ? order.costVerified : false);
    const [carYear, setCarYear] = useState<string>(order?.carYear || '');
    const [trouble, setTrouble] = useState<boolean>(order?.trouble ?? false);

    const canEdit = isAdmin || isLead;
    const userSubteam = session?.user.subteam;
    const [canDeleteOrder, setCanDeleteOrder] = useState(false);

    useEffect(() => {
        if (order && isLead && userSubteam === order.subteam) {
            const orderCreatedAt = new Date(order.createdAt);
            const currentTime = new Date();
            const timeInterval = 1 * 60 * 60 * 1000; // 1 hour
            const timeDifference = currentTime.getTime() - orderCreatedAt.getTime();
            if (timeDifference <= timeInterval) {
                setCanDeleteOrder(true);
            }
        }
    }, [order, isLead, userSubteam]);

    useEffect(() => {
        if (order) {
            const updatedCostBreakdown = {
                AERO: 0,
                CHS: 0,
                SUS: 0,
                BAT: 0,
                ECE: 0,
                PT: 0,
                DBMS: 0,
                SW: 0,
                ...(order.costBreakdown || {}),
            };
            setCostBreakdown(updatedCostBreakdown);
        }
    }, [order]);

    const handleCarrierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setCarrier(e.target.value);
    };

    const handleTrackingIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTrackingId(e.target.value);
    };

    const handleOrderStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setOrderStatus(e.target.value as OrderStatus);
    };

    const handleItemStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setItemStatus(e.target.value as ItemStatus);
    };

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPrice(parseFloat(e.target.value));
        setPriceEdited(true);
    };

    const { data: supportingDocs } = useSWR<Document[]>(
        order ? `/api/orders/${order.id}/documents` : null,
        fetcher
    );

    const { data: receiptsData, mutate: mutateReceipts } = useSWR<Document[]>(
        order ? `/api/orders/${order.id}/receipts` : null,
        fetcher
    );

    useEffect(() => {
        if (receiptsData) {
            setReceipts(receiptsData);
        }
    }, [receiptsData]);

    const handleSave = async () => {
        try {
            if (item) {
                const body: UpdateItemBody = { status: itemStatus };
                const response = await fetch(`/api/items/update/${item.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!response.ok) {
                    throw new Error('Failed to update item');
                }
                onUpdateOrder();
            } else if (order) {
                if (canEdit) {
                    const totalPercentage = Object.values(costBreakdown).reduce((a, b) => a + b, 0);
                    if (totalPercentage !== 100) {
                        toast({
                            title: "Invalid Cost Breakdown",
                            description: "Cost breakdown percentages must add up to 100%",
                            variant: "destructive",
                        });
                        return;
                    }
                }
                const body: UpdateOrderBody = { status: orderStatus, comments };
                if (canEdit) {
                    body.carrier = carrier;
                    body.trackingId = trackingId;
                    body.meenOrderId = meenOrderId;
                    if (priceEdited) {
                        body.totalCost = price;
                    }
                    body.costVerified = isPriceVerified;
                }
                if (canEdit) {
                    body.costBreakdown = costBreakdown;
                    body.carYear = carYear;
                    body.trouble = trouble;
                }

                const response = await fetch(`/api/orders/update/${order.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });

                if (response.ok) {
                    toast({
                        title: "Order Updated",
                        description: "Order status updated successfully.",
                        variant: "affirmation",
                    });
                    onUpdateOrder();
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update order');
                }
            }
            onClose();
        } catch (error) {
            toast({
                title: "Update Error",
                description: (error as Error).message || 'An error occurred while updating the order.',
                variant: "destructive",
            });
            console.error('Error updating status:', error);
        }
    };

    const handleAddReceipt = () => {
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0 && order) {
            try {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.type !== 'application/pdf') {
                        toast({
                            title: 'Invalid File Type',
                            description: 'Only PDF files are allowed.',
                            variant: 'destructive',
                        });
                        continue;
                    }
                    const formData = new FormData();
                    formData.append('file', file);
                    const response = await fetch(`/api/orders/addReceipt?orderId=${order.id}`, {
                        method: 'POST',
                        body: formData,
                    });
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error);
                    }
                }
                mutateReceipts();
                toast({
                    title: 'Receipts Uploaded',
                    description: 'Receipts uploaded successfully.',
                    variant: 'affirmation',
                });
            } catch (error) {
                console.error('Error uploading receipts:', error);
                toast({
                    title: 'Upload Error',
                    description: 'An error occurred while uploading receipts.',
                    variant: 'destructive',
                });
            }
        }
    };

    const handleDeleteReceipt = async (documentId: number) => {
        try {
            const response = await fetch(`/api/orders/deleteReceipt`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ documentId }),
            });
            if (response.ok) {
                mutateReceipts();
                toast({
                    title: 'Receipt Deleted',
                    description: 'Receipt deleted successfully.',
                    variant: 'affirmation',
                });
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error);
            }
        } catch (error) {
            console.error('Error deleting receipt:', error);
            toast({
                title: 'Deletion Error',
                description: 'An error occurred while deleting the receipt.',
                variant: 'destructive',
            });
        }
    };

    const handleDeleteOrder = async () => {
        if (order) {
            try {
                const confirmed = window.confirm(
                    'Are you sure you want to delete this order? This action cannot be undone.'
                );
                if (!confirmed) return;

                const response = await fetch(`/api/orders/delete`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: order.id }),
                });

                if (response.ok) {
                    toast({
                        title: 'Order Deleted',
                        description: 'Order deleted successfully.',
                        variant: 'affirmation',
                    });
                    onUpdateOrder();
                    onClose();
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.error);
                }
            } catch (error) {
                console.error('Error deleting order:', error);
                toast({
                    title: 'Deletion Error',
                    description: 'An error occurred while deleting the order.',
                    variant: 'destructive',
                });
            }
        }
    };

    const handleDownloadExcel = () => {
        if (order && order.items && order.items.length > 0) {
            const wb = XLSX.utils.book_new();
            const headers = ['Item', 'Part Number', 'Notes', 'QTY to Buy', 'Cost', 'Vendor', 'Link'];
            const rows = order.items.map(item => [
                item.name || '',
                item.partNumber || '',
                item.notes || '',
                item.quantity,
                item.price,
                item.vendor || '',
                item.link || ''
            ]);
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            XLSX.utils.book_append_sheet(wb, ws, "Order Items");
            const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.setAttribute('download', `${order.name}.xlsx`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const breakdownTotal = Object.values(costBreakdown).reduce((a, b) => a + b, 0);
    const fileName = (url: string) => decodeURIComponent(url.split('/').pop() || url);
    const canComment = !!order && (canEdit || session?.user.subteam === order.subteam);
    const showDelete = !!order && !item && (canEdit || canDeleteOrder);

    const title = item ? item.name : order?.name;
    const meta = item
        ? [item.vendor, item.quantity ? `Qty ${item.quantity}` : null, item.price != null ? money(item.price) : null]
        : order
            ? [order.meenOrderId ? `#${order.meenOrderId}` : null, order.user.name, order.subteam, order.deliveryLocation, new Date(order.createdAt).toLocaleDateString(), money(order.totalCost)]
            : [];

    return (
        <div className={styles.overlay} onMouseDown={handleOverlayMouseDown}>
            <div className={styles.settingsMenu} role="dialog" aria-modal="true" aria-labelledby="settings-title">
                <header className={styles.formHeader}>
                    <div className={styles.titleBlock}>
                        <h2 id="settings-title" className={styles.formTitle} title={title}>{title}</h2>
                        <p className={styles.meta}>{meta.filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className={styles.headerActions}>
                        {order && !item && !order.url && order.items && order.items.length > 0 && (
                            <button className={styles.iconButton} onClick={handleDownloadExcel} aria-label="Download items as Excel" title="Download items as Excel">
                                <Download size={16} aria-hidden />
                            </button>
                        )}
                        <button className={styles.iconButton} onClick={onClose} aria-label="Close" title="Close">
                            <X size={16} aria-hidden />
                        </button>
                    </div>
                </header>

                <div className={styles.body}>
                    {isAdminLoading ? (
                        <p className={styles.muted}>Loading…</p>
                    ) : item ? (
                        <section className={styles.section}>
                            <dl className={styles.details}>
                                <dt>Part number</dt>
                                <dd>{item.partNumber || <span className={styles.dash}>—</span>}</dd>
                                <dt>Link</dt>
                                <dd>
                                    {item.link ? (
                                        <a href={item.link} target="_blank" rel="noopener noreferrer" className={styles.itemLink}>
                                            {item.link}
                                        </a>
                                    ) : <span className={styles.dash}>—</span>}
                                </dd>
                                <dt>Quantity</dt>
                                <dd className={styles.num}>{item.quantity ?? <span className={styles.dash}>—</span>}</dd>
                                {item.notes && (
                                    <>
                                        <dt>Notes</dt>
                                        <dd>{item.notes}</dd>
                                    </>
                                )}
                            </dl>
                            {canEdit && (
                                <div className={styles.field}>
                                    <label htmlFor="item-status">Status</label>
                                    <select id="item-status" value={itemStatus} onChange={handleItemStatusChange}>
                                        {Object.values(ItemStatus).map((option) => (
                                            <option key={option} value={option}>{statusLabel(option)}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </section>
                    ) : order && (
                        <>
                            {canEdit ? (
                                <section className={styles.section}>
                                    <h3 className={styles.sectionTitle}>Order details</h3>
                                    <div className={styles.fieldGrid}>
                                        <div className={styles.field}>
                                            <label htmlFor="order-status">Status</label>
                                            <select id="order-status" value={orderStatus} onChange={handleOrderStatusChange}>
                                                {(SELECTABLE_ORDER_STATUSES.includes(orderStatus)
                                                    ? SELECTABLE_ORDER_STATUSES
                                                    : [orderStatus, ...SELECTABLE_ORDER_STATUSES]
                                                ).map((option) => (
                                                    <option key={option} value={option}>{statusLabel(option)}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className={styles.field}>
                                            <label htmlFor="meen-id">MEEN order ID</label>
                                            <input id="meen-id" type="text" value={meenOrderId} onChange={(e) => setMeenOrderId(e.target.value)} />
                                        </div>
                                        <div className={styles.field}>
                                            <div className={styles.labelRow}>
                                                <label htmlFor="order-price">Price</label>
                                                <label className={styles.checkboxLabel}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isPriceVerified}
                                                        onChange={(e) => setIsPriceVerified(e.target.checked)}
                                                    />
                                                    Verified
                                                </label>
                                            </div>
                                            <div className={styles.affix}>
                                                <span aria-hidden>$</span>
                                                <input id="order-price" type="number" step="0.01" value={price} onChange={handlePriceChange} />
                                            </div>
                                        </div>
                                        <div className={styles.field}>
                                            <label htmlFor="carrier">Carrier</label>
                                            <select id="carrier" value={carrier} onChange={handleCarrierChange}>
                                                <option value="">No carrier</option>
                                                <option value="UPS">UPS</option>
                                                <option value="FEDEX">FedEx</option>
                                            </select>
                                        </div>
                                        <div className={`${styles.field} ${styles.span2}`}>
                                            <label htmlFor="tracking-id">Tracking ID</label>
                                            <input id="tracking-id" type="text" value={trackingId} onChange={handleTrackingIdChange} placeholder={carrier ? '' : 'Pick a carrier first'} />
                                        </div>
                                        <div className={styles.field}>
                                            <label htmlFor="car-year">Car</label>
                                            <select id="car-year" value={carYear} onChange={(e) => setCarYear(e.target.value)}>
                                                {/* Keep an out-of-range value selectable so saving never rewrites it */}
                                                {!CAR_YEARS.includes(carYear) && <option value={carYear}>{carYear}</option>}
                                                {CAR_YEARS.map((year) => (
                                                    <option key={year} value={year}>{year}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className={styles.field}>
                                            <span className={styles.fieldLabel}>Trouble</span>
                                            <label className={`${styles.troubleToggle} ${trouble ? styles.troubleToggleOn : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={trouble}
                                                    onChange={(e) => setTrouble(e.target.checked)}
                                                />
                                                {trouble ? 'Flagged as trouble' : 'Flag as trouble'}
                                            </label>
                                        </div>
                                    </div>
                                    <p className={styles.fieldHint}>Flag an order as trouble when it has gone a long time with no update. Its row turns red on the home screen.</p>
                                </section>
                            ) : (
                                <section className={styles.section}>
                                    <dl className={styles.details}>
                                        <dt>Status</dt>
                                        <dd>{statusLabel(order.status)}</dd>
                                        <dt>Tracking</dt>
                                        <dd>{order.trackingId ? `${order.carrier ?? ''} ${order.trackingId}`.trim() : <span className={styles.dash}>—</span>}</dd>
                                        <dt>Car</dt>
                                        <dd>{order.carYear}</dd>
                                        {order.trouble && (
                                            <>
                                                <dt>Trouble</dt>
                                                <dd className={styles.troubleText}>Flagged: no update in a long time</dd>
                                            </>
                                        )}
                                    </dl>
                                </section>
                            )}

                            {canEdit && (
                                <section className={styles.section}>
                                    <div className={styles.sectionHeader}>
                                        <h3 className={styles.sectionTitle}>Cost breakdown</h3>
                                        <span className={`${styles.total} ${breakdownTotal === 100 ? styles.totalOk : styles.totalOff}`}>
                                            {breakdownTotal === 100 ? 'Total 100%' : `Total ${breakdownTotal}% · must be 100%`}
                                        </span>
                                    </div>
                                    <div className={styles.breakdownGrid}>
                                        {Object.keys(subteamMapping).map((subteam) => (
                                            <label key={subteam} className={styles.breakdownItem} title={subteamMapping[subteam]}>
                                                <span>{subteam}</span>
                                                <span className={`${styles.affix} ${styles.affixEnd}`}>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={100}
                                                        className={costBreakdown[subteam] ? styles.filled : undefined}
                                                        value={costBreakdown[subteam]}
                                                        onFocus={(e) => e.target.select()}
                                                        onChange={(e) => {
                                                            const value = parseFloat(e.target.value) || 0;
                                                            setCostBreakdown((prev) => ({ ...prev, [subteam]: value }));
                                                        }}
                                                    />
                                                    <span aria-hidden>%</span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {canComment && (
                                <section className={styles.section}>
                                    <label htmlFor="order-comments" className={styles.sectionTitle}>Comments</label>
                                    <textarea
                                        id="order-comments"
                                        value={comments}
                                        onChange={(e) => setComments(e.target.value)}
                                        className={styles.textarea}
                                        placeholder="Notes for the team, e.g. quantity or delivery details"
                                        rows={3}
                                    />
                                </section>
                            )}

                            {(canEdit || (supportingDocs && supportingDocs.length > 0)) && (
                                <section className={styles.section}>
                                    <div className={styles.sectionHeader}>
                                        <h3 className={styles.sectionTitle}>Files</h3>
                                        {canEdit && (
                                            <>
                                                <button onClick={handleAddReceipt} className={`${styles.button} ${styles.ghostButton}`}>
                                                    <Upload size={14} aria-hidden />
                                                    Add receipt
                                                </button>
                                                <input
                                                    type="file"
                                                    multiple
                                                    accept="application/pdf"
                                                    ref={fileInputRef}
                                                    style={{ display: 'none' }}
                                                    onChange={handleFileUpload}
                                                />
                                            </>
                                        )}
                                    </div>
                                    <ul className={styles.fileList}>
                                        {supportingDocs?.map((doc) => (
                                            <li key={`doc-${doc.id}`} className={styles.fileRow}>
                                                <a href={doc.url} target="_blank" rel="noopener noreferrer" className={styles.docLink} title={fileName(doc.url)}>
                                                    <FileText size={16} aria-hidden />
                                                    <span className={styles.docName}>{fileName(doc.url)}</span>
                                                </a>
                                                <span className={styles.fileKind}>Supporting doc</span>
                                            </li>
                                        ))}
                                        {canEdit && receipts.map((doc) => (
                                            <li key={`receipt-${doc.id}`} className={styles.fileRow}>
                                                <a href={doc.url} target="_blank" rel="noopener noreferrer" className={styles.docLink} title={fileName(doc.url)}>
                                                    <FileText size={16} aria-hidden />
                                                    <span className={styles.docName}>{fileName(doc.url)}</span>
                                                </a>
                                                <span className={styles.fileKind}>Receipt</span>
                                                <button
                                                    onClick={() => handleDeleteReceipt(doc.id)}
                                                    className={styles.iconButton}
                                                    aria-label={`Delete receipt ${fileName(doc.url)}`}
                                                    title="Delete receipt"
                                                >
                                                    <Trash2 size={14} aria-hidden />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                    {canEdit && receipts.length === 0 && (
                                        <p className={styles.emptyFiles}>No receipts yet. Add the PDF once the order is paid.</p>
                                    )}
                                </section>
                            )}
                        </>
                    )}
                </div>

                <footer className={styles.buttonGroup}>
                    {showDelete && (
                        <button onClick={handleDeleteOrder} className={`${styles.button} ${styles.dangerButton}`}>
                            Delete order
                        </button>
                    )}
                    <div className={styles.footerEnd}>
                        <button onClick={onClose} className={`${styles.button} ${styles.cancelButton}`}>
                            Cancel
                        </button>
                        <button onClick={handleSave} className={`${styles.button} ${styles.saveButton}`} disabled={isAdminLoading}>
                            Save
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default SettingsMenu;
