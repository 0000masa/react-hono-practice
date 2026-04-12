import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const Callback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const error = searchParams.get('error');

    if (error) {
      alert(decodeURIComponent(error));
      navigate('/login');
      return;
    }

    // BetterAuthがcallbackURLに直接リダイレクトするため、
    // ここに到達した場合はダッシュボードへ
    navigate('/dashboard');
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600">認証処理中...</p>
      </div>
    </div>
  );
};

export default Callback;
