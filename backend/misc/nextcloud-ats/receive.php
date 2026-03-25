<?php

$queueFile = __DIR__ . '/queue.json';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Принимаем данные от АТС
    $message = $_POST['message'] ?? '';

    if (!$message) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'No message provided']);
        exit;
    }

    // Загружаем текущую очередь
    $queue = [];
    if (file_exists($queueFile)) {
        $raw = file_get_contents($queueFile);
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $queue = $decoded;
        }
    }

    // Добавляем новый звонок
    $queue[] = [
        'message'   => $message,
        'received'  => date('Y-m-d H:i:s'),
    ];

    file_put_contents($queueFile, json_encode($queue, JSON_UNESCAPED_UNICODE));

    echo json_encode(['ok' => true]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Отдаём очередь боту и сразу очищаем её
    $calls = [];

    if (file_exists($queueFile)) {
        $raw = file_get_contents($queueFile);
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $calls = $decoded;
        }
        // Очищаем очередь
        file_put_contents($queueFile, json_encode([]));
    }

    echo json_encode(['ok' => true, 'calls' => $calls], JSON_UNESCAPED_UNICODE);

} else {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
}
