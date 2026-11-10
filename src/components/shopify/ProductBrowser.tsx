'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Link2,
  Loader2,
  Package,
  Search,
  Send,
  TextCursorInput,
} from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { buildProductMessageText, formatShopifyPrice, formatVariantOptions } from '@/lib/shopify/product-message';
import type { ShopifyPage, ShopifyProductDetail, ShopifyProductSummary, ShopifyVariant } from '@/lib/shopify/types';

export interface ShareProductArgs {
  product: ShopifyProductDetail;
  variant: ShopifyVariant;
  /** Only set when the agent edited the message; otherwise the server builds it from fresh Shopify data */
  caption?: string;
}

/**
 * Which store to browse: the store mapped to channelId, else to the contact's channel (there is no default store).
 * Pass the same channel and contact the product will be shared through, so browsing and sharing use one store.
 */
export interface ProductStoreScope {
  channelId?: number | null;
  customerId?: number | null;
}

interface ProductBrowserProps {
  storeScope?: ProductStoreScope;
  /** Shows the review → send step; without it the browser is read-only */
  onShare?: (args: ShareProductArgs) => Promise<boolean>;
  /** "Insert as text" puts the message into the composer instead of sending it */
  onInsertText?: (text: string) => void;
  /** Why sharing is unavailable in this conversation (e.g. the channel can't send yet) */
  shareDisabledReason?: string | null;
  className?: string;
}

const isDefaultOnly = (product: ShopifyProductDetail) =>
  product.variants.length <= 1 &&
  (product.options.length === 0 || (product.options.length === 1 && product.options[0].values[0] === 'Default Title'));

const matches = (variant: ShopifyVariant, selection: Record<string, string>) =>
  variant.selectedOptions.every((o) => selection[o.name] === o.value);

const optionsOf = (variant: ShopifyVariant) =>
  Object.fromEntries(variant.selectedOptions.map((o) => [o.name, o.value])) as Record<string, string>;

function priceLabel(p: ShopifyProductSummary) {
  if (!p.priceMin) return '—';
  const min = formatShopifyPrice(p.priceMin.amount, p.priceMin.currencyCode);
  if (p.priceMax && p.priceMax.amount !== p.priceMin.amount) return `From ${min}`;
  return min;
}

function sharedFor(product: ShopifyProductDetail, variant: ShopifyVariant) {
  const multi = !isDefaultOnly(product);
  return {
    title: product.title,
    variantTitle: multi ? variant.title : null,
    options: multi ? variant.selectedOptions : [],
    sku: variant.sku,
    price: variant.price,
    currencyCode: product.currencyCode,
    available: variant.available,
    // Same URL the server builds when sending
    productUrl: product.productUrl ? (multi ? `${product.productUrl}?variant=${variant.legacyId}` : product.productUrl) : null,
  };
}

const Availability: React.FC<{ available: boolean }> = ({ available }) => (
  <span
    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${
      available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
    }`}
  >
    {available ? 'In stock' : 'Out of stock'}
  </span>
);

export const ProductBrowser: React.FC<ProductBrowserProps> = ({ storeScope, onShare, onInsertText, shareDisabledReason, className = '' }) => {
  const scopeChannelId = storeScope?.channelId ?? undefined;
  const scopeCustomerId = storeScope?.customerId ?? undefined;

  // Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShopifyPage<ShopifyProductSummary> | null>(null);
  const [isSearching, setIsSearching] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const searchSeq = useRef(0);

  // Detail
  const [productId, setProductId] = useState<string | null>(null);
  const [product, setProduct] = useState<ShopifyProductDetail | null>(null);
  const [productError, setProductError] = useState<ApiError | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [imageIndex, setImageIndex] = useState(0);

  // Review
  const [isReviewing, setIsReviewing] = useState(false);
  const [caption, setCaption] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  const runSearch = useCallback(async (term: string, after?: string | null) => {
    const seq = ++searchSeq.current;
    if (after) setIsLoadingMore(true);
    else setIsSearching(true);
    try {
      const res = await apiClient.get('/api/integrations/shopify/products', {
        params: { q: term || undefined, after: after || undefined, channelId: scopeChannelId, customerId: scopeCustomerId },
      });
      if (seq !== searchSeq.current) return;
      const page: ShopifyPage<ShopifyProductSummary> = { items: res.data.items, hasNextPage: res.data.hasNextPage, endCursor: res.data.endCursor };
      setResults((prev) => (after && prev ? { ...page, items: [...prev.items, ...page.items] } : page));
      setSearchError(null);
    } catch (err) {
      if (seq !== searchSeq.current) return;
      if (after) notifyError(err, { where: 'ProductBrowser.loadMore', title: "Couldn't load more products" });
      else setSearchError(toApiError(err));
    } finally {
      if (seq === searchSeq.current) {
        setIsSearching(false);
        setIsLoadingMore(false);
      }
    }
  }, [scopeChannelId, scopeCustomerId]);

  // Debounced search as the agent types
  useEffect(() => {
    const t = setTimeout(() => runSearch(query.trim()), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const loadProduct = useCallback(async (id: string) => {
    setProduct(null);
    setProductError(null);
    try {
      const res = await apiClient.get(`/api/integrations/shopify/products/${id}`, {
        params: { channelId: scopeChannelId, customerId: scopeCustomerId },
      });
      const detail: ShopifyProductDetail = res.data.product;
      setProduct(detail);
      const initial = detail.variants.find((v) => v.available) || detail.variants[0];
      setSelection(initial ? optionsOf(initial) : {});
      setImageIndex(0);
    } catch (err) {
      setProductError(toApiError(err));
    }
  }, [scopeChannelId, scopeCustomerId]);

  // Another conversation (or send channel) can mean another store: a product picked in the old one isn't valid here
  useEffect(() => {
    setProductId(null);
    setProduct(null);
    setIsReviewing(false);
  }, [scopeChannelId, scopeCustomerId]);

  useEffect(() => {
    if (productId) loadProduct(productId);
  }, [productId, loadProduct]);

  const selectedVariant = useMemo(
    () => (product ? product.variants.find((v) => matches(v, selection)) ?? null : null),
    [product, selection]
  );

  // Show the variant's own image when it has one
  useEffect(() => {
    if (!product || !selectedVariant?.imageUrl) return;
    const idx = product.images.findIndex((img) => img.url === selectedVariant.imageUrl);
    if (idx >= 0) setImageIndex(idx);
  }, [product, selectedVariant]);

  const images = useMemo(() => {
    if (!product) return [];
    if (product.images.length > 0) return product.images;
    return selectedVariant?.imageUrl ? [{ url: selectedVariant.imageUrl, altText: null }] : [];
  }, [product, selectedVariant]);

  const chooseValue = (name: string, value: string) => {
    if (!product) return;
    const next = { ...selection, [name]: value };
    if (product.variants.some((v) => matches(v, next))) {
      setSelection(next);
      return;
    }
    // That combination doesn't exist: jump to the closest real variant with this value, preferring in-stock ones
    const candidates = product.variants.filter((v) => v.selectedOptions.some((o) => o.name === name && o.value === value));
    const best = candidates.find((v) => v.available) || candidates[0];
    setSelection(best ? optionsOf(best) : next);
  };

  /** How a value chip looks given the other selected options */
  const valueState = (name: string, value: string): 'available' | 'soldout' | 'none' => {
    if (!product) return 'none';
    const withValue = product.variants.filter((v) =>
      v.selectedOptions.every((o) => (o.name === name ? o.value === value : selection[o.name] === o.value))
    );
    if (withValue.length === 0) return 'none';
    return withValue.some((v) => v.available) ? 'available' : 'soldout';
  };

  const openReview = () => {
    if (!product || !selectedVariant) return;
    setCaption(buildProductMessageText(sharedFor(product, selectedVariant)));
    setIsReviewing(true);
  };

  const backToList = () => {
    setProductId(null);
    setProduct(null);
    setIsReviewing(false);
  };

  const handleShare = async () => {
    if (!product || !selectedVariant || !onShare) return;
    const generated = buildProductMessageText(sharedFor(product, selectedVariant));
    setIsSharing(true);
    const ok = await onShare({ product, variant: selectedVariant, caption: caption.trim() !== generated.trim() ? caption : undefined });
    setIsSharing(false);
    if (ok) setIsReviewing(false);
  };

  const handleInsert = () => {
    if (!onInsertText) return;
    onInsertText(caption);
    setIsReviewing(false);
    gooeyToast.success('Product details added to the reply box');
  };

  // ---------------------------------------------------------------
  // Search + list
  // ---------------------------------------------------------------
  const searchBox = (
    <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white focus-within:border-[#3440a8]">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (productId) backToList();
        }}
        placeholder="Search product in Shopify"
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
              title={query ? 'No matching products' : 'No active products'}
              description={query ? 'Try another name, SKU or barcode.' : 'Active products in your Shopify store show up here.'}
              compact
            />
          ) : (
            <ul className="space-y-1.5">
              {results?.items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setProductId(p.legacyId)}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-slate-200 hover:border-[#c7cdf0] hover:bg-[#f7f8fd] text-left cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-md bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageOff className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-slate-900 truncate">{p.title}</p>
                      <p className="text-[11.5px] text-slate-600">{priceLabel(p)}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-400 truncate">
                        <Availability available={p.available} />
                        {p.variantsCount > 1 ? <span>{p.variantsCount} variants</span> : p.sku ? <span className="truncate">SKU {p.sku}</span> : null}
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
              onClick={() => runSearch(query.trim(), results.endCursor)}
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

  // ---------------------------------------------------------------
  // Product detail
  // ---------------------------------------------------------------
  const showOptions = product && !isDefaultOnly(product);
  const price = selectedVariant && product ? formatShopifyPrice(selectedVariant.price, product.currencyCode) : null;
  const compareAt =
    selectedVariant?.compareAtPrice && product && Number(selectedVariant.compareAtPrice) > Number(selectedVariant.price)
      ? formatShopifyPrice(selectedVariant.compareAtPrice, product.currencyCode)
      : null;
  const variantUrl = product && selectedVariant ? sharedFor(product, selectedVariant).productUrl : null;

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
        ) : isReviewing && selectedVariant ? (
          /* ---------------- Review before sending ---------------- */
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-slate-500 tracking-wider">REVIEW MESSAGE</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
              {(selectedVariant.imageUrl || images[0]?.url) && (
                <img src={selectedVariant.imageUrl || images[0].url} alt="" className="w-full max-h-48 object-contain bg-slate-50" />
              )}
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 1024))}
                rows={7}
                className="w-full p-2.5 text-[12.5px] text-slate-800 outline-none resize-none border-t border-slate-100"
                aria-label="Message text"
              />
            </div>
            {!selectedVariant.available && (
              <p className="text-[11.5px] text-red-600 bg-red-50 rounded-lg px-2.5 py-2">
                This option is out of stock. The customer will see that in the message.
              </p>
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
            {/* Images */}
            <div className="relative rounded-lg overflow-hidden bg-slate-100 aspect-[4/3] flex items-center justify-center">
              {images.length > 0 ? (
                <img src={images[imageIndex]?.url} alt={images[imageIndex]?.altText || product.title} className="w-full h-full object-cover" />
              ) : (
                <ImageOff className="w-6 h-6 text-slate-400" />
              )}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setImageIndex((i) => (i - 1 + images.length) % images.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 shadow flex items-center justify-center cursor-pointer"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageIndex((i) => (i + 1) % images.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 shadow flex items-center justify-center cursor-pointer"
                    aria-label="Next image"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
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

            {/* Title, price, link */}
            <div>
              <h3 className="text-[15px] font-bold text-slate-900 leading-snug">{product.title}</h3>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[13.5px] text-slate-800">{price ?? '—'}</span>
                {compareAt && <span className="text-[12px] text-slate-400 line-through">{compareAt}</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
                {selectedVariant && <Availability available={selectedVariant.available} />}
                {selectedVariant?.sku && <span>SKU {selectedVariant.sku}</span>}
                {variantUrl && (
                  <a
                    href={variantUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in online store"
                    className="text-slate-500 hover:text-[#3440a8]"
                  >
                    <Link2 className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Options from Shopify (Size, Color, Material…) */}
            {showOptions &&
              product.options.map((option) => (
                <div key={option.name}>
                  <p className="text-[11.5px] text-slate-500 mb-1">
                    {option.name}: <span className="text-slate-800 font-medium">{selection[option.name] ?? '—'}</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {option.values.map((value) => {
                      const state = valueState(option.name, value);
                      const selected = selection[option.name] === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => chooseValue(option.name, value)}
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
              ))}

            {product.hasMoreVariants && (
              <p className="text-[11px] text-slate-400">Only the first 100 variants are listed for this product.</p>
            )}

            {product.description && (
              <p className="text-[12.5px] text-slate-600 leading-relaxed whitespace-pre-line line-clamp-6">{product.description}</p>
            )}

            {/* Share */}
            {(onShare || onInsertText) && (
              <div className="pt-1 space-y-1.5">
                <button
                  type="button"
                  onClick={openReview}
                  disabled={!selectedVariant}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" /> Share in conversation
                </button>
                {!selectedVariant && <p className="text-[11px] text-red-600">This combination isn&apos;t offered. Pick another option.</p>}
                {selectedVariant && showOptions && (
                  <p className="text-[11px] text-slate-400 truncate">Selected: {formatVariantOptions(selectedVariant.selectedOptions)}</p>
                )}
              </div>
            )}

            {product.productUrl && !onShare && (
              <a
                href={product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#3440a8] hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" /> View in online store
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
