'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ImageOff, Link2, Loader2, Package, Search, Send, TextCursorInput } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { buildProductMessageText, formatShopifyPrice as formatPrice } from '@/lib/shopify/product-message';
import type { WooProductDetail, WooProductPage, WooProductSummary, WooVariation } from '@/lib/woocommerce/types';

export interface ShareWooProductArgs {
  storeId: number;
  product: WooProductDetail;
  /** null for simple products */
  variation: WooVariation | null;
  /** Only set when the agent edited the message; otherwise the server builds it from fresh store data */
  caption?: string;
}

/** The store picked in the inbox's switcher and the conversation it's browsed for */
export interface WooProductScope {
  storeId: number;
  channelId?: number | null;
  customerId?: number | null;
}

interface WooProductBrowserProps {
  scope: WooProductScope;
  onShare?: (args: ShareWooProductArgs) => Promise<boolean>;
  onInsertText?: (text: string) => void;
  shareDisabledReason?: string | null;
  className?: string;
}

const price = (amount: string, currency: string) => (amount === '' ? '—' : formatPrice(amount, currency));

/** A variation matches when each of its attributes equals the selection ("any" when it doesn't set one) */
const matches = (v: WooVariation, selection: Record<string, string>) =>
  v.attributes.every((a) => !a.option || selection[a.name] === a.option);

const Availability: React.FC<{ available: boolean }> = ({ available }) => (
  <span
    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${
      available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
    }`}
  >
    {available ? 'In stock' : 'Out of stock'}
  </span>
);

function messageFor(product: WooProductDetail, variation: WooVariation | null) {
  return buildProductMessageText({
    title: product.name,
    variantTitle: null,
    options: (variation?.attributes ?? []).filter((a) => a.option).map((a) => ({ name: a.name, value: a.option })),
    sku: variation?.sku ?? product.sku,
    price: variation?.price || product.price || '0',
    currencyCode: product.currencyCode,
    available: variation ? variation.available : product.available,
    productUrl: product.permalink,
  });
}

/** Search a WooCommerce store's products, pick an option and share it in the conversation (or insert it as text) */
export const WooProductBrowser: React.FC<WooProductBrowserProps> = ({ scope, onShare, onInsertText, shareDisabledReason, className = '' }) => {
  const { storeId } = scope;
  const channelId = scope.channelId ?? undefined;
  const customerId = scope.customerId ?? undefined;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WooProductPage | null>(null);
  const [isSearching, setIsSearching] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const searchSeq = useRef(0);

  const [productId, setProductId] = useState<number | null>(null);
  const [product, setProduct] = useState<WooProductDetail | null>(null);
  const [productError, setProductError] = useState<ApiError | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [imageIndex, setImageIndex] = useState(0);

  const [isReviewing, setIsReviewing] = useState(false);
  const [caption, setCaption] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  const runSearch = useCallback(
    async (term: string, page = 1) => {
      const seq = ++searchSeq.current;
      if (page > 1) setIsLoadingMore(true);
      else setIsSearching(true);
      try {
        const res = await apiClient.get('/api/integrations/woocommerce/products', {
          params: { q: term || undefined, page, storeId, channelId, customerId },
        });
        if (seq !== searchSeq.current) return;
        const next: WooProductPage = { items: res.data.items, page: res.data.page, hasNextPage: res.data.hasNextPage };
        setResults((prev) => (page > 1 && prev ? { ...next, items: [...prev.items, ...next.items] } : next));
        setSearchError(null);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        if (page > 1) notifyError(err, { where: 'WooProductBrowser.loadMore', title: "Couldn't load more products" });
        else setSearchError(toApiError(err));
      } finally {
        if (seq === searchSeq.current) {
          setIsSearching(false);
          setIsLoadingMore(false);
        }
      }
    },
    [storeId, channelId, customerId]
  );

  useEffect(() => {
    const t = setTimeout(() => runSearch(query.trim()), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const loadProduct = useCallback(
    async (id: number) => {
      setProduct(null);
      setProductError(null);
      try {
        const res = await apiClient.get(`/api/integrations/woocommerce/products/${id}`, { params: { storeId, channelId, customerId } });
        const detail: WooProductDetail = res.data.product;
        setProduct(detail);
        const initial = detail.variations.find((v) => v.available) || detail.variations[0];
        setSelection(initial ? Object.fromEntries(initial.attributes.filter((a) => a.option).map((a) => [a.name, a.option])) : {});
        setImageIndex(0);
      } catch (err) {
        setProductError(toApiError(err));
      }
    },
    [storeId, channelId, customerId]
  );

  // Another store or conversation: a product picked in the old one isn't valid here
  useEffect(() => {
    setProductId(null);
    setProduct(null);
    setIsReviewing(false);
  }, [storeId, channelId, customerId]);

  useEffect(() => {
    if (productId) loadProduct(productId);
  }, [productId, loadProduct]);

  const isVariable = Boolean(product && product.type === 'variable');
  const variation = useMemo(
    () => (product && isVariable ? product.variations.find((v) => matches(v, selection)) ?? null : null),
    [product, isVariable, selection]
  );

  const images = useMemo(() => {
    if (!product) return [];
    const list = [...product.images];
    if (variation?.imageUrl && !list.some((i) => i.url === variation.imageUrl)) list.unshift({ url: variation.imageUrl, altText: null });
    return list;
  }, [product, variation]);

  useEffect(() => {
    if (!variation?.imageUrl) return;
    const idx = images.findIndex((i) => i.url === variation.imageUrl);
    if (idx >= 0) setImageIndex(idx);
  }, [variation, images]);

  const valueState = (name: string, value: string): 'available' | 'soldout' | 'none' => {
    if (!product) return 'none';
    const candidates = product.variations.filter((v) => matches(v, { ...selection, [name]: value }));
    if (candidates.length === 0) return 'none';
    return candidates.some((v) => v.available) ? 'available' : 'soldout';
  };

  const chooseValue = (name: string, value: string) => {
    if (!product) return;
    const next = { ...selection, [name]: value };
    if (product.variations.some((v) => matches(v, next))) {
      setSelection(next);
      return;
    }
    // That combination doesn't exist: jump to the closest real variation with this value, preferring in-stock ones
    const candidates = product.variations.filter((v) => v.attributes.some((a) => a.name === name && (!a.option || a.option === value)));
    const best = candidates.find((v) => v.available) || candidates[0];
    setSelection(best ? { ...Object.fromEntries(best.attributes.filter((a) => a.option).map((a) => [a.name, a.option])), [name]: value } : next);
  };

  const canShareThis = Boolean(product) && (!isVariable || Boolean(variation));
  const shareBlocked = Boolean(shareDisabledReason) && !onInsertText;

  const openReview = () => {
    if (!product || !canShareThis) return;
    setCaption(messageFor(product, variation));
    setIsReviewing(true);
  };

  const backToList = () => {
    setProductId(null);
    setProduct(null);
    setIsReviewing(false);
  };

  const handleShare = async () => {
    if (!product || !onShare) return;
    const generated = messageFor(product, variation);
    setIsSharing(true);
    const ok = await onShare({ storeId, product, variation, caption: caption.trim() !== generated.trim() ? caption : undefined });
    setIsSharing(false);
    if (ok) setIsReviewing(false);
  };

  const handleInsert = () => {
    if (!onInsertText) return;
    onInsertText(caption);
    setIsReviewing(false);
    gooeyToast.success('Product details added to the reply box');
  };

  const searchBox = (
    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white focus-within:border-[#3440a8]">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (productId) backToList();
        }}
        placeholder="Search product in WooCommerce"
        className="flex-1 min-w-0 px-3 py-2 text-[13px] outline-none bg-transparent"
        aria-label="Search products by name or SKU"
      />
      <span className="px-2.5 text-slate-400 border-l border-slate-200 self-stretch flex items-center">
        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      </span>
    </div>
  );

  if (!productId) {
    return (
      <div className={`flex flex-col min-h-0 ${className}`}>
        {searchBox}
        <div className="mt-3 flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {searchError ? (
            <ErrorState error={searchError} title="Couldn't search products" compact onRetry={() => runSearch(query.trim())} />
          ) : isSearching && !results ? (
            <LoadingState label="Loading products…" compact />
          ) : results && results.items.length === 0 ? (
            <EmptyState
              icon={<Package className="w-5 h-5" />}
              title={query ? 'No matching products' : 'No published products'}
              description={query ? 'Try another name or SKU.' : 'Published products in your WooCommerce store show up here.'}
              compact
            />
          ) : (
            <ul className="space-y-1.5">
              {results?.items.map((p: WooProductSummary) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setProductId(p.id)}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-slate-200 hover:border-[#c7cdf0] hover:bg-[#f7f8fd] text-left cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-md bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <ImageOff className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-slate-900 truncate">{p.name}</p>
                      <p className="text-[11.5px] text-slate-600">
                        {p.type === 'variable' && p.price !== '' ? 'From ' : ''}
                        {price(p.price, p.currencyCode)}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-400 truncate">
                        <Availability available={p.available} />
                        {p.variationsCount > 1 ? <span>{p.variationsCount} options</span> : p.sku ? <span className="truncate">SKU {p.sku}</span> : null}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results?.hasNextPage && !searchError && (
            <button
              type="button"
              onClick={() => runSearch(query.trim(), results.page + 1)}
              disabled={isLoadingMore}
              className="mt-2 w-full py-2 text-xs font-semibold text-[#3440a8] rounded-lg hover:bg-[#eef0fb] cursor-pointer disabled:opacity-60"
            >
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const shownPrice = product ? price(variation?.price ?? product.price, product.currencyCode) : null;
  const regular = variation ? variation.regularPrice : product?.regularPrice;
  const current = variation?.price ?? product?.price;
  const compareAt = product && regular && current && Number(regular) > Number(current) ? price(regular, product.currencyCode) : null;
  const available = variation ? variation.available : product?.available;
  const sku = variation?.sku ?? product?.sku;

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {searchBox}
      <button
        type="button"
        onClick={isReviewing ? () => setIsReviewing(false) : backToList}
        className="mt-3 self-start flex items-center gap-1 text-[13px] text-slate-700 hover:text-slate-900 cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-2 flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-2">
        {productError ? (
          <ErrorState error={productError} title="Couldn't load this product" compact onRetry={() => loadProduct(productId)} />
        ) : !product ? (
          <LoadingState label="Loading product…" compact />
        ) : isReviewing ? (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-slate-500 tracking-wider">REVIEW MESSAGE</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
              {(variation?.imageUrl || images[0]?.url) && (
                <img src={variation?.imageUrl || images[0].url} alt="" className="w-full max-h-48 object-contain bg-slate-50" />
              )}
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 1024))}
                rows={7}
                className="w-full p-2.5 text-[12.5px] text-slate-800 outline-none resize-none border-t border-slate-100"
                aria-label="Message text"
              />
            </div>
            {available === false && (
              <p className="text-[11.5px] text-red-600 bg-red-50 rounded-lg px-2.5 py-2">This option is out of stock. The customer will see that in the message.</p>
            )}
            {shareDisabledReason && <p className="text-[11.5px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">{shareDisabledReason}</p>}
            <div className="flex gap-2">
              {onInsertText && (
                <button
                  type="button"
                  onClick={handleInsert}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  title="Put the text in the reply box (no image)"
                >
                  <TextCursorInput className="w-3.5 h-3.5" /> Insert as text
                </button>
              )}
              {onShare && (
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={isSharing || Boolean(shareDisabledReason) || !caption.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-[12.5px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-slate-100 aspect-[4/3] flex items-center justify-center">
              {images.length > 0 ? (
                <img src={images[imageIndex]?.url} alt={images[imageIndex]?.altText || product.name} className="w-full h-full object-cover" />
              ) : (
                <ImageOff className="w-6 h-6 text-slate-400" />
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => setImageIndex(i)}
                    className={`w-14 h-14 rounded-md overflow-hidden shrink-0 border-2 cursor-pointer ${
                      i === imageIndex ? 'border-[#3440a8]' : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                  >
                    <img src={img.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div>
              <h3 className="text-[15px] font-bold text-slate-900 leading-snug">{product.name}</h3>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[13.5px] text-slate-800">{shownPrice}</span>
                {compareAt && <span className="text-[12px] text-slate-400 line-through">{compareAt}</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
                {available !== undefined && <Availability available={available} />}
                {sku && <span>SKU {sku}</span>}
                {product.permalink && (
                  <a href={product.permalink} target="_blank" rel="noopener noreferrer" title="Open in online store" className="text-slate-500 hover:text-[#3440a8]">
                    <Link2 className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            {isVariable &&
              product.attributes.map((attribute) =>
                attribute.options.length === 1 ? (
                  <p key={attribute.name} className="text-[11.5px] text-slate-500">
                    {attribute.name}: <span className="text-slate-800 font-medium">{attribute.options[0]}</span>
                  </p>
                ) : (
                  <div key={attribute.name}>
                    <p className="text-[11.5px] text-slate-500 mb-1">
                      {attribute.name}: <span className="text-slate-800 font-medium">{selection[attribute.name] ?? '—'}</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {attribute.options.map((value) => {
                        const state = valueState(attribute.name, value);
                        const selected = selection[attribute.name] === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => chooseValue(attribute.name, value)}
                            title={state === 'soldout' ? 'Out of stock' : state === 'none' ? 'Not offered with the other selected options' : undefined}
                            className={`px-2.5 py-1 rounded-md text-[12px] border cursor-pointer ${
                              selected
                                ? 'border-[#3440a8] bg-[#eef0fb] text-[#3440a8] font-semibold'
                                : state === 'available'
                                  ? 'border-slate-200 bg-slate-100/70 text-slate-700 hover:border-slate-300'
                                  : 'border-dashed border-slate-200 text-slate-400 line-through'
                            }`}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

            {product.hasMoreVariations && <p className="text-[11px] text-slate-400">Only the first 100 options are listed for this product.</p>}

            {product.description && (
              <p className="text-[12.5px] text-slate-600 leading-relaxed whitespace-pre-line line-clamp-6">{product.description}</p>
            )}

            {(onShare || onInsertText) && (
              <div className="pt-1 space-y-1.5">
                {shareBlocked && <p role="status" className="text-[11.5px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">{shareDisabledReason}</p>}
                <button
                  type="button"
                  onClick={openReview}
                  disabled={!canShareThis || shareBlocked}
                  title={shareBlocked ? shareDisabledReason ?? undefined : undefined}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" /> Share in conversation
                </button>
                {isVariable && !variation && <p className="text-[11px] text-red-600">This combination isn&apos;t offered. Pick another option.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
