// api.js — DEAD FILE (tidak di-import siapa pun)
// Sengaja sebagai test deteksi dead file di proyek React

import axios from 'axios';

const BASE_URL = 'https://api.example.com';

export async function getUsers() {
    const response = await axios.get(`${BASE_URL}/users`);
    return response.data;
}

export async function getPostById(id) {
    const response = await axios.get(`${BASE_URL}/posts/${id}`);
    return response.data;
}
