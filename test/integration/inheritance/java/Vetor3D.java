
public class Vetor3D {
    private int x = 0;
    private int y = 0;
    private int z = 0;
    
    Vetor3D() { }
    
    Vetor3D(int x, int y, int z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public int getX() {
        return x;
    }

    public int getY() {
        return y;
    }

    public int getZ() {
        return z;
    }

    public void setX(int x) {
        this.x = x;
    }
    
}
