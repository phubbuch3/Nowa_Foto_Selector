export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const stripeKeyBase64 = 'cmtfbGl2ZV81MVRHa0ZqMVFTVGdxTlRkaXluYk5DVjNNV21VUmdpWmVUeWxtT1FiWEJhWkRXdnBXc2VOMzBUVGtTSVFiMWlaa00xRld6NnhvdWU3Q1dnenh0WjdIM0JnNzAwZ0lkZ0x1QzE=';
    const stripeKey = Buffer.from(stripeKeyBase64, 'base64').toString('utf-8');

    const { amount, projectId, successUrl, cancelUrl } = req.body;

    const formBody = new URLSearchParams({
        'payment_method_types[0]': 'card',
        'payment_method_types[1]': 'twint',
        'line_items[0][price_data][currency]': 'chf',
        'line_items[0][price_data][product_data][name]': 'Zusätzliche Retuschen',
        'line_items[0][price_data][unit_amount]': String(amount * 100), // in Rappen
        'line_items[0][quantity]': '1',
        'mode': 'payment',
        'success_url': successUrl,
        'cancel_url': cancelUrl
    }).toString();

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + stripeKey,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formBody
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
    }

    const data = await response.json();
    return res.status(200).json({ url: data.url });

  } catch (error) {
    console.error("Stripe Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
