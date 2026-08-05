"""
잇다 (Itda) - 2단계 ML 분류기 학습
규칙엔진이 확신 분류한 데이터를 학습셋으로 사용 (cold-start 대응).
학습된 모델은 model.joblib로 저장 -> pipeline에서 재사용.
"""
import sqlite3
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from itda_rules import rule_classify

CONFIDENCE_THRESHOLD = 0.85  # 검수로 확정한 임계값


def train_and_save(ipmsg_db_path: str, model_out_path: str = "model.joblib"):
    conn = sqlite3.connect(ipmsg_db_path)
    cur = conn.cursor()
    cur.execute("SELECT body FROM msg_tbl;")
    bodies = [r[0] for r in cur.fetchall()]
    conn.close()

    labeled_texts, labeled_cats = [], []
    for body in bodies:
        cat, reason, cleaned = rule_classify(body)
        if cat != 'ambiguous_ai' and cleaned:
            labeled_texts.append(cleaned)
            labeled_cats.append(cat)

    print(f"학습 데이터: {len(labeled_texts)}건")

    vectorizer = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4), max_features=8000, min_df=2)
    X = vectorizer.fit_transform(labeled_texts)

    clf = LogisticRegression(max_iter=2000, class_weight='balanced', C=5.0)
    clf.fit(X, labeled_cats)

    joblib.dump({'vectorizer': vectorizer, 'clf': clf, 'threshold': CONFIDENCE_THRESHOLD}, model_out_path)
    print(f"모델 저장 완료: {model_out_path}")
    return vectorizer, clf


if __name__ == "__main__":
    train_and_save("ipmsg.db", "model.joblib")
