import client from './client';

export const searchApi = {
  search: (from, to, date) => {
    let url = `/search/trains?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    if (date) url += `&date=${date}`;
    return client.get(url).then((r) => r.data);
  },
  autocomplete: (q) => client.get(`/search/autocomplete?q=${encodeURIComponent(q)}`).then((r) => r.data),
};
