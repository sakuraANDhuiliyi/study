package cn.huiliyi.verification;
import com.android.uiautomator.core.Configurator;
import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
import android.view.accessibility.AccessibilityNodeInfo;
public final class HierarchyDump extends UiAutomatorTestCase {
  public static final class ScrollNode extends UiObject {
    public ScrollNode() { super(new UiSelector().scrollable(true).instance(0)); }
    public boolean move(boolean forward) {
      AccessibilityNodeInfo node = findAccessibilityNodeInfo(0L);
      if (node == null) return false;
      try {
        return node.performAction(forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                                          : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
      } finally { node.recycle(); }
    }
  }
  public void testDump() throws Exception {
    Configurator.getInstance().setWaitForIdleTimeout(0L);
    Configurator.getInstance().setWaitForSelectorTimeout(0L);
    String scroll = getParams().getString("scroll");
    if (scroll != null) {
      if (!scroll.equals("forward") && !scroll.equals("backward"))
        throw new IllegalArgumentException("Invalid scroll direction");
      System.out.println(new ScrollNode().move(scroll.equals("forward")) ? "SCROLL_ACTION" : "SCROLL_EDGE");
      Thread.sleep(350L);
    }
    for (int attempt = 0; attempt < 10; attempt++) {
      Thread.sleep(100L);
      getUiDevice().dumpWindowHierarchy("zhixue-review.xml");
      if (new java.io.File("/data/local/tmp/zhixue-review.xml").isFile()) break;
    }
    if (!new java.io.File("/data/local/tmp/zhixue-review.xml").isFile()) {
      System.out.println("NO_ACTIVE_WINDOW");
    }
  }
}
