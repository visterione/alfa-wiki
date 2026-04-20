module.exports = {
  apps: [
    {
      name: 'alfa-wiki',
      script: 'server.js',
      cwd: './backend',

      // Один процесс — не cluster mode, т.к. Socket.IO требует единого состояния
      instances: 1,
      exec_mode: 'fork',

      // Автоперезапуск при падении
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',       // не засчитывать рестарт если упал быстрее 10 сек
      restart_delay: 2000,     // 2 сек пауза между рестартами

      // Логи пишутся в папку logs/ в корне проекта
      error_file: '../logs/pm2-error.log',
      out_file: '../logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Переменные окружения
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },

      // При деплое — graceful reload вместо kill
      kill_timeout: 5000,
      wait_ready: false,
    }
  ]
};
