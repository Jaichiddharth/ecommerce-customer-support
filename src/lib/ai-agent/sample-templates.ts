/** Downloadable templates for sample data (AI agent > Test data). Client-safe: no server imports. */

export const SAMPLE_ORDERS_CSV = `order_number,customer_name,email,phone,status,items,quantity,order_date,shipping_date,expected_delivery,delivered_at,courier,tracking_number,tracking_url,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_pincode,shipping_country
#1001,Asha Kumar,asha@example.com,+919800000001,Pending,Linen shirt,1,2026-11-18,,,,,,,"Flat 4B, Lakshmi Residency, 12 MG Road",Near Trinity Metro,Bengaluru,Karnataka,560001,India
#1002,Asha Kumar,asha@example.com,+919800000001,Shipped,Denim jacket,1,2026-11-12,2026-11-14,2026-11-20,,Delhivery,DL123456,https://www.delhivery.com/track/package/DL123456,"Flat 4B, Lakshmi Residency, 12 MG Road",Near Trinity Metro,Bengaluru,Karnataka,560001,India
#1003,Ravi S,ravi@example.com,+919800000002,Delivered,Running shoes,1,2026-11-01,2026-11-02,,2026-11-05,Blue Dart,BD998877,,"No. 7, 2nd Cross Street, Anna Nagar",Opp. Tower Park,Chennai,Tamil Nadu,600040,India
#1004,Ravi S,ravi@example.com,+919800000002,Cancelled,Cotton kurta,2,2026-10-28,,,,,,,"No. 7, 2nd Cross Street, Anna Nagar",,Chennai,Tamil Nadu,600040,India
#1005,Meena R,meena@example.com,+919800000003,Out for delivery,Silk saree,1,2026-11-15,2026-11-16,2026-11-19,,Ekart,EK554433,,"House 21, Sector 15",Near Gurudwara,Gurugram,Haryana,122001,India
`;

export const SAMPLE_ORDERS_JSON = JSON.stringify(
  {
    orders: [
      {
        id: 1001, name: "#1001", created_at: "2026-11-18T10:00:00Z", fulfillment_status: null, financial_status: "paid",
        line_items: [{ title: "Linen shirt", quantity: 1 }],
        shipping_address: { name: "Asha Kumar", address1: "Flat 4B, Lakshmi Residency, 12 MG Road", address2: "Near Trinity Metro", city: "Bengaluru", province: "Karnataka", zip: "560001", country: "India", phone: "+919800000001" },
        customer: { id: 501, first_name: "Asha", last_name: "Kumar", email: "asha@example.com", phone: "+919800000001" },
      },
      {
        id: 1002, name: "#1002", created_at: "2026-11-12T10:00:00Z", fulfillment_status: "fulfilled", financial_status: "paid",
        line_items: [{ title: "Denim jacket", quantity: 1 }],
        fulfillments: [{ status: "success", shipment_status: "in_transit", created_at: "2026-11-14T09:00:00Z", tracking_company: "Delhivery", tracking_number: "DL123456", tracking_url: "https://www.delhivery.com/track/package/DL123456" }],
        shipping_address: { name: "Asha Kumar", address1: "Flat 4B, Lakshmi Residency, 12 MG Road", address2: "Near Trinity Metro", city: "Bengaluru", province: "Karnataka", zip: "560001", country: "India", phone: "+919800000001" },
        customer: { id: 501, first_name: "Asha", last_name: "Kumar", email: "asha@example.com", phone: "+919800000001" },
      },
    ],
  },
  null,
  2,
);

export const SAMPLE_PRODUCTS_CSV = `title,price,compare_at_price,currency,description,category,tags,available,image_url,url
Linen shirt,1499,1999,INR,Breathable linen shirt for hot days,Shirts,summer linen casual,yes,,
Denim jacket,3299,,INR,Classic blue denim jacket with a relaxed fit,Jackets,denim winter,yes,,
Running shoes,2799,3499,INR,Lightweight cushioned running shoes,Shoes,sports running,yes,,
Silk saree,8999,,INR,Handwoven Kanchipuram silk saree,Sarees,wedding festive silk,yes,,
Cotton kurta,1199,,INR,Everyday cotton kurta,Kurtas,cotton daily,no,,
`;

export const SAMPLE_PRODUCTS_JSON = JSON.stringify(
  [
    { title: "Linen shirt", price: 1499, compare_at_price: 1999, currency: "INR", description: "Breathable linen shirt for hot days", tags: "summer linen", available: true },
    { title: "Denim jacket", price: 3299, currency: "INR", description: "Classic blue denim jacket", tags: "denim winter", available: true },
  ],
  null,
  2,
);
