import client from './client';

export const bookingApi = {
  create: (data) => client.post('/bookings/bookings', data).then((r) => r.data),

  list: (status, page = 1, limit = 10) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('page', page);
    qs.set('limit', limit);
    return client.get(`/bookings/bookings?${qs.toString()}`).then((r) => r.data);
  },

  getById: (id) => client.get(`/bookings/bookings/${id}`).then((r) => r.data),

  verifyPayment: (id, data) => client.post(`/bookings/bookings/${id}/verify-payment`, data).then((r) => r.data),

  cancel: (id) => client.post(`/bookings/bookings/${id}/cancel`).then((r) => r.data),
};
