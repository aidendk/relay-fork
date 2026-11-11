'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { SerializedOrderWithRelations } from '../order-table/order-table';
import styles from './backlog-component.module.css';
import useSWR, { mutate } from 'swr';
import Image from 'next/image';
import LinkIcon from "../../../assets/link.svg";
import { Item, ItemStatus, OrderStatus } from '@prisma/client';
import CloseIcon from "../../../assets/close.svg"
import EmptyIcon from "../../../assets/empty.svg"
import { useToast } from '../toast/use-toast';
import { useSession } from 'next-auth/react';
import { checkAdmin } from '../../lib/checkAdmin';

interface Document {
    id: number;
    url: string;
    orderId: number;
    uploadedAt: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
    VD: 'Vehicle Dynamics',
};

const BacklogComponent: React.FC = () => {
    const { data: session, status } = useSession();
    const [isAdmin, setIsAdmin] = useState(false);
    const [isAdminLoading, setIsAdminLoading] = useState(true);

    useEffect(() => {
        if (status === 'loading') return;

        if (!session) {
            setIsAdmin(false);
            setIsAdminLoading(false);
            return;
        }

        checkAdmin()
            .then(setIsAdmin)
            .catch(() => setIsAdmin(false))
            .finally(() => setIsAdminLoading(false));
    }, [session, status]);

    useEffect(() => {
        if (isAdminLoading || isAdmin) return;
        window.location.href = '/';
    }, [isAdmin, isAdminLoading]);
    
    const { data, error } = useSWR('/api/orders?limit=500', fetcher, { refreshInterval: 60000 });
    const { toast } = useToast();

    const orders = useMemo(() => (data?.orders as SerializedOrderWithRelations[] || []), [data]);
    const [isMeenOrderIdModalOpen, setIsMeenOrderIdModalOpen] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
    const [isMarkAsPickedUpModalOpen, setIsMarkAsPickedUpModalOpen] = useState(false);
    const [markAsPickedUpTarget, setMarkAsPickedUpTarget] = useState<{type: 'order'|'item', id: number}|null>(null);

    // Orders to be Placed
    const ordersToBePlaced = useMemo(() => orders.filter(order => order.status === 'TO_ORDER'), [orders]);

    // Orders to be Picked Up
    const ordersWithDeliveredItems = useMemo(() => {
        // Only include orders that are not archived
        const nonArchivedOrders = orders.filter(order => order.status !== 'ARCHIVED' && order.status !== 'EV_ARCHIVED');
        return nonArchivedOrders.filter(order => 
            order.status === 'EV_AWAITING_PICKUP' || 
            order.items.some(item => item.status === 'DELIVERED')
        );
    }, [orders]);

    // Separate state variables for each table
    const [expandedOrderIdsToBePlaced, setExpandedOrderIdsToBePlaced] = useState<number[]>([]);
    const [expandedOrderIdsToBePickedUp, setExpandedOrderIdsToBePickedUp] = useState<number[]>([]);

    const toggleExpandToBePlaced = (orderId: number, orderItems: Item[]) => {
        if (orderItems.length > 0) {
            setExpandedOrderIdsToBePlaced((prev) =>
                prev.includes(orderId)
                    ? prev.filter((id) => id !== orderId)
                    : [...prev, orderId]
            );
        }
    };

    const toggleExpandToBePickedUp = (orderId: number, orderItems: Item[]) => {
        if (orderItems.length > 0) {
            setExpandedOrderIdsToBePickedUp((prev) =>
                prev.includes(orderId)
                    ? prev.filter((id) => id !== orderId)
                    : [...prev, orderId]
            );
        }
    };

    const handleMarkOrder = (orderId: number) => {
        setSelectedOrderId(orderId);
        setIsMeenOrderIdModalOpen(true);
    };

    const handleMarkOrderAsPickedUp = (orderId: number) => {
        setMarkAsPickedUpTarget({type: 'order', id: orderId});
        setIsMarkAsPickedUpModalOpen(true);
    };
    
    const handleMarkItem = (itemId: number) => {
        setMarkAsPickedUpTarget({type: 'item', id: itemId});
        setIsMarkAsPickedUpModalOpen(true);
    };

    const submitMarkAsPickedUp = async (comment: string) => {
        if (!markAsPickedUpTarget) return;
      
        // Find the order ID if target is item
        let orderIdToUpdate: number | null = null;
        if (markAsPickedUpTarget.type === 'order') {
          orderIdToUpdate = markAsPickedUpTarget.id;
        } else {
          // If it's an item, find which order it belongs to
          const allOrders = orders || [];
          for (const o of allOrders) {
            if (o.items.some(i => i.id === markAsPickedUpTarget.id)) {
              orderIdToUpdate = o.id;
              break;
            }
          }
        }
      
        if (!orderIdToUpdate) {
          toast({
            title: "Update Failed",
            description: "Could not find the order for the item.",
            variant: "destructive",
          });
          setIsMarkAsPickedUpModalOpen(false);
          setMarkAsPickedUpTarget(null);
          return;
        }
      
        // First update the order comments
        try {
          const updateResponse = await fetch(`/api/orders/update/${orderIdToUpdate}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ comments: comment }),
          });
      
          if (!updateResponse.ok) {
            toast({
              title: "Update Failed",
              description: "Failed to update comments before pickup.",
              variant: "destructive",
            });
            setIsMarkAsPickedUpModalOpen(false);
            setMarkAsPickedUpTarget(null);
            return;
          }
        } catch (error) {
          console.error(error);
          toast({
            title: "Error",
            description: "An error occurred while updating comments.",
            variant: "destructive",
          });
          setIsMarkAsPickedUpModalOpen(false);
          setMarkAsPickedUpTarget(null);
          return;
        }
      
        // After successful comment update, call the markPickedUp endpoint
        let endpoint = '';
        if (markAsPickedUpTarget.type === 'order') {
          endpoint = `/api/orders/${markAsPickedUpTarget.id}/markPickedUp`;
        } else {
          endpoint = `/api/items/${markAsPickedUpTarget.id}/markPickedUp`;
        }
      
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ comments: comment }),
          });
      
          if (response.ok) {
            mutate((key: string) => typeof key === 'string' && key.startsWith('/api/orders'));
            mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
            toast({
              title: markAsPickedUpTarget.type === 'order' ? "Order Picked Up" : "Item Picked Up",
              description: markAsPickedUpTarget.type === 'order' ? "Order has been picked up." : "Item has been picked up.",
              variant: "affirmation",
            });
          } else {
            toast({
              title: "Update Failed",
              description: "Failed to finalize pickup.",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error(error);
          toast({
            title: "Error",
            description: "An error occurred.",
            variant: "destructive",
          });
        } finally {
          setIsMarkAsPickedUpModalOpen(false);
          setMarkAsPickedUpTarget(null);
        }
      };
      
    if (error) {
        return <div>Error loading orders.</div>;
    }

    if (!data) {
        return <div>Loading orders...</div>;
    }

    if (!isAdmin) return null;

    const MeenOrderIdModal: React.FC<{ onClose: () => void; onSubmit: (meenOrderId: string) => void; }> = ({ onClose, onSubmit }) => {
        const [meenOrderId, setMeenOrderId] = useState('');
        const { toast } = useToast();
    
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setMeenOrderId(e.target.value);
        };
    
        const handleSubmit = () => {
            if (meenOrderId.trim() === '') {
                toast({
                    title: "Missing MEEN Order ID",
                    description: "Please enter a MEEN Order ID.",
                    variant: "destructive",
                });
                return;
            }
            onSubmit(meenOrderId);
        };
    
        return (
            <div className={styles.overlay}>
                <div className={styles.settingsMenu}>
                    <div className={styles.formHeader}>
                        <h3 className={styles.formTitle}>Enter MEEN Order ID</h3>
                        <button className={styles.closeButton} onClick={onClose}>
                            <Image src={CloseIcon.src} height={10} width={10} alt='close'/>
                        </button>
                    </div>
                    <div className={styles.settingsGroup}>
                        <div className={styles.inputGroup}>
                            <label>MEEN Order ID:</label>
                            <input
                                type="text"
                                value={meenOrderId}
                                onChange={handleChange}
                                placeholder="Enter MEEN Order ID"
                            />
                        </div>
                    </div>
                    <div className={styles.buttonGroup}>
                        <button onClick={onClose} className={`${styles.cancelButton} ${styles.button}`}>
                            Cancel
                        </button>
                        <button onClick={handleSubmit} className={`${styles.saveButton} ${styles.button}`}>
                            Submit
                        </button>
                    </div>
                </div>
            </div>
        );
    };    

    const MarkAsPickedUpModal: React.FC<{
        onClose: () => void;
        onSubmit: (comment: string) => void;
      }> = ({ onClose, onSubmit }) => {
        const [comment, setComment] = useState('');
        const { toast } = useToast();
      
        const handleSubmit = () => {
          if (comment.trim() === '') {
            toast({
              title: "Missing Drop-off Location",
              description: "Please enter where you dropped off the order/item.",
              variant: "destructive",
            });
            return;
          }
          onSubmit(comment);
        };
      
        return (
          <div className={styles.overlay}>
            <div className={styles.settingsMenu}>
              <div className={styles.formHeader}>
                <h3 className={styles.formTitle}>Mark as Picked Up</h3>
                <button className={styles.closeButton} onClick={onClose}>
                    <Image src={CloseIcon.src} height={10} width={10} alt='close'/>
                </button>
              </div>
              <div className={styles.settingsGroup}>
                <div className={styles.inputGroup}>
                  <label>Drop-off Location:</label>
                  <input
                    type="text"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Enter location where the order/item was dropped off"
                  />
                </div>
              </div>
              <div className={styles.buttonGroup}>
                <button onClick={onClose} className={`${styles.cancelButton} ${styles.button}`}>
                    Cancel
                </button>
                <button onClick={handleSubmit} className={`${styles.saveButton} ${styles.button}`}>
                    Submit
                </button>
              </div>
            </div>
          </div>
        );
    };


    return (
        <div className={styles.tableMainContainer}>
            {/* Orders to be Placed Section */}
            <div className={styles.section}>
                <h1 className={styles.purchaseHeader}>Orders to be Placed</h1>
                {/* Desktop Table */}
                <div className={styles.tableContainer}>
                    <table className={styles.tableBody}>
                        <thead className={styles.tableHeader}>
                            <tr>
                                <th className={`${styles.thText} ${styles.datePlacedColumn}`}>Date Placed</th>
                                <th className={`${styles.thText}`}>Name</th>
                                <th className={`${styles.thText} ${styles.vendorColumn}`}>Vendor</th>
                                <th className={`${styles.thText} ${styles.linkColumn}`}>Link</th>
                                <th className={`${styles.thText} ${styles.priceColumn}`}>Price</th>
                                <th className={`${styles.thText} ${styles.subteamColumn}`}>Subteam</th>
                                <th className={`${styles.thText}`}>Cost Breakdown</th>
                                <th className={`${styles.thText} ${styles.documentsColumn}`}>Documents</th>
                                <th className={`${styles.thText}`}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ordersToBePlaced.map((order) => (
                                <React.Fragment key={order.id}>
                                    <tr
                                        onClick={() => toggleExpandToBePlaced(order.id, order.items)}
                                        className={styles.order}
                                    >
                                        <td className={`${styles.tdText} ${styles.textColumn}`}>
                                            {new Date(order.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.nameColumn}`}>
                                            {order.name}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn} ${styles.vendorColumn}`}>
                                            {order.vendor}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn}`}>
                                            {order.url ? (
                                                <button
                                                    className={styles.linkButton}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(order.url!, '_blank');
                                                    }}
                                                >
                                                    <Image
                                                        src={LinkIcon.src}
                                                        height={15}
                                                        width={15}
                                                        alt="link"
                                                    />
                                                </button>
                                            ) : (
                                                'N/A'
                                            )}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn} ${styles.priceColumn}`}>
                                            ${order.totalCost.toFixed(2)}{' '}
                                            {order.costVerified && (
                                                <span className={styles.checkMark}>✓</span>
                                            )}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn}`}>
                                            {order.user.subteam}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.costBreakdownColumn}`}>
                                            {order.costBreakdown ? (
                                                <div className={styles.costBreakdownText}>
                                                    {Object.entries(order.costBreakdown)
                                                        .filter(([, percentage]) => percentage as number > 0)
                                                        .map(([subteam, percentage]) => (
                                                            <div key={subteam} className={styles.breakdownItem}>
                                                                {Object.keys(subteamMapping).find(key => subteamMapping[key] === subteam) || subteam}: {percentage as number}%
                                                            </div>
                                                        ))}
                                                </div>
                                            ) : (
                                                'N/A'
                                            )}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.documentsColumn}`}>
                                            {order.supportingDocs && order.supportingDocs.length > 0 ? (
                                                <div className={styles.docsContainer}>
                                                    {order.supportingDocs.map((doc: Document, index:number) => (
                                                        <a
                                                            key={index}
                                                            href={doc.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={styles.docLink}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <span className={styles.docIcon}>📄</span>
                                                            <span className={styles.docName}>{doc.url.split('/').pop()}</span>
                                                        </a>
                                                    ))}
                                                </div>
                                            ) : (
                                                'N/A'
                                            )}
                                        </td>
                                        <td className={`${styles.tdText}`}>
                                            <button
                                                className={styles.markOrderButton}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMarkOrder(order.id);
                                                }}
                                            >
                                                Mark Order
                                            </button>
                                        </td>
                                    </tr>
                                    {expandedOrderIdsToBePlaced.includes(order.id) && (
                                        <tr key={`expanded-${order.id}`}>
                                            <td colSpan={8}>
                                            <div className={styles.expandedOrder}>
                                                {order.items.map((item) => (
                                                    <div key={item.id} className={styles.expandedOrderContent}>
                                                        <div className={styles.itemLeftCol}>
                                                            <h4>
                                                                {item.link ? (
                                                                    <a
                                                                        href={item.link}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className={styles.itemNameLink}
                                                                    >
                                                                        {item.name.length > 21
                                                                            ? item.name.slice(0, 21) + '...'
                                                                            : item.name}
                                                                    </a>
                                                                ) : (
                                                                    item.name.length > 21
                                                                        ? item.name.slice(0, 21) + '...'
                                                                        : item.name
                                                                )}
                                                            </h4>
                                                            <p>{item.vendor}</p>
                                                            <p>${item.price.toFixed(2)}</p>
                                                        </div>
                                                        <div className={styles.placedItemRightCol}>
                                                            <p>PN: {item.partNumber ? item.partNumber : "N/A"}</p>
                                                            <p>Q: {item.quantity}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
                {/* Mobile Card View */}
                <div className={styles.mobileCardList}>
                    {ordersToBePlaced.map((order) => (
                        <div key={order.id} className={styles.mobileCard} onClick={() => toggleExpandToBePlaced(order.id, order.items)}>
                            <div className={styles.mobileCardTop}>
                                <div className={styles.mobileCardInfo}>
                                    <span className={styles.mobileCardName}>{order.name}</span>
                                    <span className={styles.mobileCardMeta}>
                                        {order.vendor} &middot; ${order.totalCost.toFixed(2)} &middot; {order.user.subteam}
                                    </span>
                                    <span className={styles.mobileCardDate}>{new Date(order.createdAt).toLocaleDateString()}</span>
                                </div>
                                <button className={styles.markOrderButton} onClick={(e) => { e.stopPropagation(); handleMarkOrder(order.id); }}>
                                    Mark
                                </button>
                            </div>
                            {order.costBreakdown && (
                                <div className={styles.mobileCardBreakdown}>
                                    {Object.entries(order.costBreakdown)
                                        .filter(([, p]) => (p as number) > 0)
                                        .map(([s, p]) => <span key={s} className={styles.mobileCardTag}>{Object.keys(subteamMapping).find(key => subteamMapping[key] === s) || s}: {p as number}%</span>)}
                                </div>
                            )}
                            {expandedOrderIdsToBePlaced.includes(order.id) && order.items.length > 0 && (
                                <div className={styles.mobileCardItems}>
                                    {order.items.map((item) => (
                                        <div key={item.id} className={styles.mobileCardItem}>
                                            <div>
                                                <span className={styles.mobileCardItemName}>
                                                    {item.link ? <a href={item.link} target="_blank" rel="noopener noreferrer" className={styles.itemNameLink} onClick={(e) => e.stopPropagation()}>{item.name}</a> : item.name}
                                                </span>
                                                <span className={styles.mobileCardItemMeta}>{item.vendor} &middot; ${item.price.toFixed(2)} &middot; Q: {item.quantity}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                {ordersToBePlaced.length === 0 && (
                <div className={styles.emptyState}>
                    <p>No orders to place right now. 🌟</p>
                    <p>All set on the ordering front!</p>
                    <Image
                        src={EmptyIcon.src}
                        height={100}
                        width={100}
                        alt="No orders to place"
                    />
                </div>
            )}
            </div>

            {/* Orders to be Picked Up Section */}
            <div className={styles.section}>
                <h1 className={styles.purchaseHeader}>Orders to be Picked Up</h1>
                {/* Desktop Table */}
                <div className={styles.tableContainer}>
                    <table className={styles.tableBody}>
                        <thead className={styles.tableHeader}>
                            <tr>
                                <th className={`${styles.thText} ${styles.datePlacedColumn}`}>Date Placed</th>
                                <th className={`${styles.thText}`}>Name</th>
                                <th className={`${styles.thText} ${styles.vendorColumn}`}>Vendor</th>
                                <th className={`${styles.thText} ${styles.linkColumn}`}>Link</th>
                                <th className={`${styles.thText}`}>Status</th>
                                <th className={`${styles.thText} ${styles.subteamColumn}`}>Subteam</th>
                                <th className={`${styles.thText}`}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ordersWithDeliveredItems.map((order) => (
                                <React.Fragment key={order.id}>
                                    <tr
                                        onClick={() => toggleExpandToBePickedUp(order.id, order.items)}
                                        className={styles.order}
                                    >
                                        <td className={`${styles.tdText} ${styles.textColumn}`}>
                                            {new Date(order.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.nameColumn}`}>
                                            {order.name}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn} ${styles.vendorColumn}`}>
                                            {order.vendor}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn}`}>
                                            {order.url ? (
                                                <button
                                                    className={styles.linkButton}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        window.open(order.url!, '_blank');
                                                    }}
                                                >
                                                    <Image
                                                        src={LinkIcon.src}
                                                        height={15}
                                                        width={15}
                                                        alt="link"
                                                    />
                                                </button>
                                            ) : (
                                                'N/A'
                                            )}
                                        </td>
                                        <td
                                            className={`${styles.tdText} ${
                                                order.status === OrderStatus.TO_ORDER ? styles.orderStatusToOrder
                                                : order.status === OrderStatus.PLACED ? styles.orderStatusPlaced
                                                : order.status === OrderStatus.PROCESSED ? styles.orderStatusProcessed
                                                : order.status === OrderStatus.PARTIAL ? styles.orderStatusPartial
                                                : order.status === OrderStatus.DELIVERED || order.status === OrderStatus.EV_AWAITING_PICKUP ? styles.orderStatusDelivered
                                                : styles.orderStatusShipped
                                            } ${styles.statusColumn}`}
                                        >
                                            {order.status.toUpperCase()}
                                        </td>
                                        <td className={`${styles.tdText} ${styles.textColumn}`}>
                                            {order.user.subteam}
                                        </td>
                                        <td className={`${styles.tdText}`}>
                                            <button
                                                className={styles.markOrderButton}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMarkOrderAsPickedUp(order.id);
                                                }}
                                            >
                                                Mark Order
                                            </button>
                                        </td>
                                    </tr>
                                    {expandedOrderIdsToBePickedUp.includes(order.id) && (
                                        <tr key={`expanded-${order.id}`}>
                                            <td colSpan={7}>
                                                <div className={styles.expandedOrder}>
                                                    {order.items.map((item) => (
                                                        <div key={item.id} className={styles.expandedOrderContent}>
                                                            <div className={styles.itemLeftCol}>
                                                                <h4>{item.name.length > 18 ? item.name.slice(0, 18) + '...' : item.name}</h4>
                                                                <p>{item.vendor}</p>
                                                                <p>${item.price.toFixed(2)}</p>
                                                            </div>
                                                            <div className={styles.itemRightCol}>
                                                                <p className={`${styles.itemStatusText} ${
                                                                    item.status === ItemStatus.TO_ORDER ? styles.itemStatusToOrder
                                                                    : item.status === ItemStatus.PLACED ? styles.orderStatusPlaced
                                                                    : item.status === ItemStatus.PROCESSED ? styles.orderStatusProcessed
                                                                    : item.status === ItemStatus.DELIVERED ? styles.itemStatusDelivered
                                                                    : item.status === ItemStatus.PICKED_UP ? styles.itemStatusPickedUp
                                                                    : styles.itemStatusShipped
                                                                } ${styles.itemStatus}`}>
                                                                    {item.status.toUpperCase()}
                                                                </p>
                                                                {item.status === ItemStatus.DELIVERED && (
                                                                    <button className={styles.markItemButton} onClick={() => handleMarkItem(item.id)}>Mark Item</button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
                {/* Mobile Card View */}
                <div className={styles.mobileCardList}>
                    {ordersWithDeliveredItems.map((order) => (
                        <div key={order.id} className={styles.mobileCard} onClick={() => toggleExpandToBePickedUp(order.id, order.items)}>
                            <div className={styles.mobileCardTop}>
                                <div className={styles.mobileCardInfo}>
                                    <span className={styles.mobileCardName}>{order.name}</span>
                                    <span className={styles.mobileCardMeta}>{order.vendor} &middot; {order.user.subteam}</span>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                    <span className={`${styles.mobileCardStatus} ${
                                        order.status === OrderStatus.DELIVERED || order.status === OrderStatus.EV_AWAITING_PICKUP ? styles.orderStatusDelivered
                                        : order.status === OrderStatus.PARTIAL ? styles.orderStatusPartial
                                        : styles.orderStatusShipped
                                    }`}>{order.status.replace(/_/g, ' ')}</span>
                                    <button className={styles.markOrderButton} onClick={(e) => { e.stopPropagation(); handleMarkOrderAsPickedUp(order.id); }}>
                                        Pick Up
                                    </button>
                                </div>
                            </div>
                            {expandedOrderIdsToBePickedUp.includes(order.id) && order.items.length > 0 && (
                                <div className={styles.mobileCardItems}>
                                    {order.items.map((item) => (
                                        <div key={item.id} className={styles.mobileCardItem}>
                                            <div>
                                                <span className={styles.mobileCardItemName}>{item.name}</span>
                                                <span className={styles.mobileCardItemMeta}>{item.vendor} &middot; ${item.price.toFixed(2)}</span>
                                            </div>
                                            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                                <span className={`${styles.mobileCardItemStatus} ${
                                                    item.status === ItemStatus.DELIVERED ? styles.itemStatusDelivered
                                                    : item.status === ItemStatus.PICKED_UP ? styles.itemStatusPickedUp
                                                    : styles.itemStatusShipped
                                                }`}>{item.status.replace(/_/g, ' ')}</span>
                                                {item.status === ItemStatus.DELIVERED && (
                                                    <button className={styles.markItemButton} onClick={(e) => { e.stopPropagation(); handleMarkItem(item.id); }}>Mark</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                {ordersWithDeliveredItems.length === 0 && (
                <div className={styles.emptyState}>
                    <p>No pending pickups. 🚚</p>
                    <p>Everything&apos;s been picked up!</p>
                    <Image
                        src={EmptyIcon.src}
                        height={100}
                        width={100}
                        alt="No orders to pick up"
                    />
                </div>
            )}
            </div>
            {isMeenOrderIdModalOpen && selectedOrderId !== null && (
                <MeenOrderIdModal
                    onClose={() => setIsMeenOrderIdModalOpen(false)}
                    onSubmit={async (meenOrderId: string) => {
                        try {
                            const response = await fetch(`/api/orders/${selectedOrderId}/updateMeenOrderId`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ meenOrderId }),
                            });

                            if (response.ok) {
                                // Update local state
                                mutate((key: string) => typeof key === 'string' && key.startsWith('/api/orders'));
            mutate((key) => typeof key === 'string' && key.startsWith('/api/finance'));
                                setIsMeenOrderIdModalOpen(false);
                                toast({
                                    title: "Order Updated",
                                    description: "MEEN Order ID updated successfully.",
                                    variant: "affirmation",
                                });
                            } else {
                                toast({
                                    title: "Update Failed",
                                    description: "Failed to update order.",
                                    variant: "destructive",
                                });
                            }
                        } catch (error) {
                            console.error(error);
                            toast({
                                title: "Error",
                                description: "An error occurred.",
                                variant: "destructive",
                            });
                        }
                    }}
                />
            )}
            {isMarkAsPickedUpModalOpen && (
            <MarkAsPickedUpModal
                onClose={() => {
                setIsMarkAsPickedUpModalOpen(false);
                setMarkAsPickedUpTarget(null);
                }}
                onSubmit={submitMarkAsPickedUp}
            />
            )}
        </div>
    );
};

export default BacklogComponent;